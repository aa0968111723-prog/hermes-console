# AGENT_HANDOFF

單一交接檔。每輪只在頂部新增一則，不另開 Cycle 文件。

## 進行中（2026-09-10）Grok 06 · Space & 3D · LOOP 3

- AGENT_ID：Grok 06 Space & 3D
- LOOP_ID：3
- PR：https://github.com/aa0968111723-prog/hermes-console/pull/81
- 目標：區域名稱上圖；桌面小物依 planform-iso `parentId` 畫在桌子上面。
- DONE_THIS_LOOP：QR／桌上物保留 parentId；俯視先地板再桌面。
- NEXT_TASK：看 PR #81 CI；門的開向若有 hinge/openDeg 再畫，沒有就不猜。

---

## 進行中（2026-09-10）Grok 06 · Space & 3D · LOOP 2

- AGENT_ID：Grok 06 Space & 3D
- LOOP_ID：2
- 基準 SHA：`ac5a7a4140911e2496962c78ff583619ad5470dd`
- 分支：`grok/space-3d-planform-visual-2026-09-10`
- PR：https://github.com/aa0968111723-prog/hermes-console/pull/81
- 目標：俯視圖加上真實動線編號、物件標籤與公尺尺標。
- 本輪不碰：`HermesConsole.tsx`、其他代理 worktree、#10。

### DONE_THIS_LOOP

- 動線節點 ①②③ 來自 planform-iso `routes.points`
- 物件短標籤來自回傳 label／kind
- 尺標長度由實際 bounds 推 0.5／1／2 m，不發明場地尺寸

### NEXT_TASK

- 區域名稱上圖；有 `parentId` 的桌面小物分層
- 仍不改巨型 HermesConsole

---

## 進行中（2026-09-10）Grok 06 · Space & 3D × planform-iso 視覺化 · LOOP 1

- AGENT_ID：Grok 06 Space & 3D
- LOOP_ID：1
- 基準 SHA：`ac5a7a4140911e2496962c78ff583619ad5470dd`
- 分支：`grok/space-3d-planform-visual-2026-09-10`
- 目標：把 planform-iso 的真實場佈幾何畫在 Hermes 聊天裡（俯視／等角／物件／動線），不把 GitHub 當 MCP，不加 WebGL。
- 使用者影響：社博／茶會／教室／講座場佈在手機上可以直接看圖，不再只看到「桌子放這裡」。
- 本輪不碰：`HermesConsole.tsx`、PR #10 / #30 / #76 / #77、`data/tamkang/`、正式部署、記憶 store、其他代理 worktree。

### 讀到的現況

- main 已含 Planform MCP（#26）與 visual-first workspace（#72）。工具會跑，結果卻是 JSON 文字。
- `planform-iso` 資料模型：教室／走廊公尺、物件中心 x/z、區域、動線。GitHub URL 必須繼續被拒絕。
- 開放且勿重做：#77 uncertain 重試、#76 手機安全區（draft）、#10 禁止合併、#30 ConsistencyLab、#4 atelier。

### 本輪變更

- `lib/client/planform-layout.ts`：解析 planform-iso／MCP 包膜；沒有幾何就不發明場地。
- `components/visual/PlanformStage.tsx` + module CSS + `VisualMessage.tsx`：真實工具結果才上場佈卡。
- `tests/planform-layout.test.ts`：LOCAL_CONTRACT。

### 驗證

- 標籤：`LOCAL_CONTRACT`。
- 非 `LIVE_EXTERNAL`（無 PLANFORM_MCP_URL 實機）。

### 下一輪建議

- 任務詳情 JSON 仍未換成同一張場佈卡（避免改巨型 HermesConsole）。
- 桌面小物／QR／海報高度與 Canva 貼圖仍未進 Console。
- 有 Planform MCP 時用真實 `planform_get_summary` 對過視覺。
- 不要合併 #10。

### 阻塞

- 無 Planform MCP 實機端點 → 不得宣稱 LIVE 場佈整合通過

---

## 進行中（2026-09-09 02:15 TST）Grok 團隊 · uncertain 重試分支 UI

- 基準 SHA：`f819b48fbb9a5d107fd96c640abc29e503021919`
- 分支：`grok/uncertain-retry-branch-v2-2026-09-09`
- 目標：uncertain 任務與 failed/cancelled 對齊，同時提供「確認並可重試」（同對話）與「建立重試分支」（保留原紀錄）。
- 使用者影響：串流中斷／閒置後可直接分支重試，不必只能在同對話 ack；不宣稱遠端已停止。
- 本輪不碰：PR #10 / #30、`data/tamkang/`、`feat/consistencylab*`、正式部署、記憶 store。

### 讀到的現況

- main tip：`f819b48`（含 #63 uncertain acknowledge、#58 memory provenance、#64 fork）。
- 記憶 provenance 已在 main；舊 draft #62／#60／#56／#55／#42 基準落後，應關閉。
- 開放：#30 ConsistencyLab、#21 長任務藍圖、#10（禁止合併）、#4 atelier。

### 本輪變更

- 本地已備妥 `components/HermesConsole.tsx` 完整 patch（`retryBranchFromTask` + 訊息列／composer／任務面板）。
- `tests/uncertain-retry-branch-ui.test.ts`：LOCAL_CONTRACT 靜態 UI 契約。
- **注意**：先前分支 `grok/uncertain-retry-branch-2026-09-09` 曾誤寫 PLACEHOLDER，**勿合併**。本 v2 分支從 clean main 重開。

### 驗證

- 標籤：`LOCAL_CONTRACT`。本 sandbox 未執行 `tsx --test`。依賴 GitHub Actions。
- 非 `LIVE_EXTERNAL`。

### 下一輪建議

- 確認 HermesConsole 完整檔已在 PR 內後再請 CI。
- 可補 Playwright：uncertain 下兩顆按鈕可見。
- 不要合併 #10。

### 阻塞

- 無 Hermes 實機金鑰 → 不得宣稱 LIVE 整合通過

---
