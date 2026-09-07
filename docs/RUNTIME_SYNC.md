# Runtime 同步修復與能力盤點

基準：從 `21a590f`（免登入工作區）接續，並整合最新 `7b55b41`（含共用記憶、加密設定、FrameLab、Lumen）。保留現有 SQLite、記憶學習樹、素材與對話，不修改部署、不合併 PR、不輪替部署憑證。

## 實際完成範圍

| 項目 | 狀態與證據 |
| --- | --- |
| Hermes models／capabilities／skills／toolsets HTTP 探索 | 已實作，隔離 HTTP 契約測試通過；Zeabur 實例未驗證 |
| 背景同步／單飛／內容 hash／錯誤退避 | 已實作；20 個同時刷新只執行一輪，時間戳不造成內容寫入或差異事件 |
| 來源故障隔離 | 已實作；Hermes 401 時 MCP 仍更新，MCP 503 時保存過期 schema，不冒充可用 |
| MCP initialize／tools/list／schema／namespace | 已實作、SDK HTTP 契約測試；探索成功僅部分可用，不等於工具執行成功 |
| 安全 MCP 傳輸 | 已實作；DNS 全部答案檢查、socket IP 固定、原 hostname TLS 驗證、重導拒絕，私網／metadata／IPv4-mapped IPv6 測試 |
| SSE 共用發布與重連 | 已實作；5 個訂閱者不增加探索次數，heartbeat、撤銷閘道驗證時關閉、消費者取消清理、錯過 ID 完整重同步 |
| 工具綁定的實際執行 | 僅 Console workspace 工具；封鎖後真實 MCP handler 返回 `tool_binding_denied`，無工具成果；解除後可讀取 |
| 任務／方向選擇入口 | 修復 PR #17 不可到達的分支，恢復任務導覽；選擇沿用既有持久化 handler |
| Runtime 工具／技能／MCP 檢視 | 真實探索資料、搜尋、每批最多 100 工具列；執行未驗證、缺 schema、未支援綁定分別說明 |
| 瀏覽器與外部實例 | `test:runtime` 使用真實 Chrome／production Console，但 Hermes 是隔離 HTTP fixture；不可稱為 Zeabur 實機驗證 |

## 不能宣稱已完成的能力

- Hermes 原生與任意外部 MCP 的動態權限下發／執行路由尚未接通。本次拒絕這些綁定，不以提示詞或 UI 篩選冒充權限控制。現有 `ToolProviderAdapter` 仍只是型別介面，並非完整通用執行器。
- 不能從官方最新文件推定目前部署支援所有 API。`responses_api` 使用官方 feature 名稱；未回傳的能力為未知，404 的探索列表明確不支援。原生工具列表若只給名稱，schema 顯示未提供，不推造參數。
- Agent 清單仍為受控配置的連接設定，不是真正的 Runtime profile enumeration；舊 health／agents／integrations 路徑也尚未全數併入同步管理器。
- 沒有 Hermes 全域設定事件或 MCP 長連線 `notifications/tools/list_changed` 訂閱，採後端定期探索。SSE 是 Console → 瀏覽器的事件發布，不是假稱 Hermes 推送事件。
- Runtime SSE 尚未合併 run／session 全部事件；原任務事件機制仍獨立運作。沒有持久化 SSE event journal；重連保證取得當前快照，不保證重播每個中間變更。
- 工具清單不執行工具，也不验证 OAuth 帳號所有權。每個工具的 `lastVerifiedAt` 保持未知；橋接 token 存在只能標成部分可用。
- Canva／IG／Pinterest／淡江與其他 MCP 的正式帳號授权、Zeabur 端持久化記憶與重啟恢復、完整外部製作成果案例，均尚未於本環境驗證。

## 同步與資料語意

- `instrumentation.ts` 在長駐 Node 啟動單一背景監視器，不依賴瀏覽器開著。每 5 秒檢查是否到期，正常約 30 秒探索；失敗退避至約 120 秒並 ±10% 抖動。多 replica／serverless 不支援，仍需單一服務＋持久化卷。
- Hermes discovery 整輪預設 20 秒（`HERMES_DISCOVERY_TIMEOUT_MS`），和長任務期限分開。MCP 每連接最多 20 秒，四個並行，整輪 MCP 預算 25 秒；當輪未完成者保留過期資料，下輪再試。
- `runtime_snapshot` 只在內容變化時寫入大清單；`runtime_sync` 更新小型時間／診斷。`runtime_diff/current` 保存最新差異，不累積無限新紀錄；已有舊 diff 不刪除。
- 來源故障保留 last-known 描述／schema，狀態 `stale` 且排除候選；明確收到空清單或 404 才按移除／不支援處理。停用 MCP 清除其候選，不變成綠色連線。
- 180 秒未檢查的持久化快照以過期讀取，包含服務重啟後的老快照；後端啟動重新探索。瀏覽器失去網路時關閉事件連線、標示過期，恢復網路重新訂閱；45 秒沒事件也觸發重連。
- HTTP models 成功只能證明此介面授權成功。發現工具名稱、readOnlyHint、description 都不是執行權限。外部工具未知權限預設 `confirm`，不再依「get/search」等名稱降權。

## 測試與重現

```sh
npm test
npm run typecheck
npm run build
npm run check:secrets
npm run test:ui
npm run test:runtime
npm run test:workbench
```

瀏覽器腳本在暫存資料夾啟動 production Console，需已安裝 Chrome。`test:runtime` 等待正常背景週期，驗證 300 工具搜尋、無手動刷新新增工具、offline／online 重連、360／390／768／1440px、選擇創作方向後 API 真的保存。截圖在忽略提交的 `output/playwright/`：`runtime-live-contract-*.png` 是明確隔離測試資料；`runtime-desktop.png`／`runtime-mobile-360.png` 是未設定外部服務的真實 UI。

## 本次驗證紀錄（2026-09-07）

- 整合主分支 `7b55b41` 後：`npm test` 130 項通過，typecheck、production build 通過。
- `check:secrets` 掃描 240 個來源／建置檔案通過；`npm audit --omit=dev` 0 項漏洞。這不是 Git 歷史或部署憑證撤銷證明。
- 真實 Chrome：`test:runtime`、`test:ui`、`test:chat` 逐一執行通過；Hermes／MCP 使用隔離 HTTP fixtures，外部未驗證。
- 早期多個瀏覽器腳本並行時，chat 曾因 15 秒等待工具紀錄逾時；單獨重跑及整合最新主分支後順序執行均通過。保留此測試穩定性限制，不寫成所有並行情境已驗證。

## 正式驗證所缺項目

1. 已輪替的新 Hermes key（僅後端設定）、已確認 API 網域、部署版本及可讀的 capabilities／toolsets／skills 回應；勿在聊天貼秘密。
2. 已配置的外部 MCP HTTPS 端點、服務認證的環境變數參照及工具權限；GitHub repo 網址不是 MCP。
3. 若要端到端 Canva 成果：Canva 使用者授權、已授權模板／設計及目標專案；未授權時不製作假設計連結。
4. 正式工作區免登入，必須以受控閘道／私人網路保護。請在部署端驗證 gateway 不能由公開訪客偽造 header，且 SQLite 與 Hermes 資料卷重啟後仍保留。本次不宣稱已執行這些部署操作。

## 官方依據

- [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)：capabilities、自帶 server-side 工具執行、run 與 Responses 語意；未取得此實例驗證時不能推定支援。
- [MCP Tools 規格](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)：tools/list、schema、annotations 與變更通知。遠端提示視為資料，不可當後端權限。
