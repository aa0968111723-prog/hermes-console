# PR #11 接續：真實執行與免登入閘道（2026-09-06）

基準為已合併的 PR #11（`7efcc06`）。保留 Agent Registry、Session Key、明亮介面與龜龜；依使用者本輪選擇，採 **免登入＋受控存取閘道**。沒有部署、社群發佈或使用已公开舊憑證。

## 已修復並可驗證

- **存取控制**：所有工作區 API 需通過後端 `CONSOLE_GATEWAY_SECRET` 驗證。Origin／轉送身份標頭不是認證。缺設定回 503、錯誤閘道回 401；只有明確允許的 loopback 開發模式可免閘道。MCP bridge 保留獨立服務 token；Canva callback 同樣受閘道保護。
- **真實創作入口**：`POST /api/intelligence` 不再依關鍵字回傳固定三方向、擅自帶入「週三傍晚」或校園地點。它沿用聊天的 Hermes 任務執行器，回傳 202、真實 task/conversation ID，可從現有任務介面查回、停止和接續。
- **保存與重試**：以必填 `requestKey` 保存創作需求、專案、參考快照及對話對應。相同提交重試沿用任務；內容不同回 409。網路失敗不產生替代文案。
- **MCP 連接管理**：端點、憑證參照與權限只能取自後端核准清單。前端不能將 `HERMES_API_KEY` 等任意秘密送往指定 URL。每次連線重新核對設定，舊的未核准記錄停用、不刪除歷史。
- **真實 MCP 協定**：以官方 SDK initialize／initialized／tools-list 與分頁探索，保留 inputSchema，限制逾時、結果大小與頁數。連線驗證不再猜工具名稱後自動 tools/call。成功列工具只記部分可用，不代表每個工具執行成功。
- **任務工具執行**：預設 MCP 呼叫必須帶有效且未結束 taskId；後端檢查專案／素材／工作流範圍，並在非同步操作前預留工具次數。每任務預設 40 次 Console MCP 嘗試，達上限或已停止後拒絕後續操作。這不會撤回已送達 Canva 的請求，也不限制 Hermes 自帶的其他工具。
- **真實讀圖**：新增 workspace_read_material，以 MCP image content 回傳經保存的 PNG 圖片實際內容；TXT 回傳真實文字。只有連結或未解析 PDF 會明確失敗，不假裝完成視覺分析；圖片 base64 不存進工具事件日誌。
- **來源與狀態**：研究計畫不再假填 retrievedAt 或已完成 web fallback；官方網址只作待查入口。只有 Client ID/Secret 不能顯示 IG/Pinterest 已授權。尚未讀圖時不產生配色、構圖借鑑建議。
- **靈感資料**：使用專案＋完整 canonical URL 雜湊識別，修正截短網址造成覆蓋；同專案去除追蹤參數後重複收藏去重。不同 URL 的空白／相同 caption 不再被當成同一張圖刪去。現有工作區 MCP 可讀取已保存靈感，不只讀取素材清單。
- **使用量**：同一任務重記用量更新固定 ID，不重複累加 token。缺少工具紀錄保留未知；事件數不等於供應商計費次數。舊的歷史用量尚未能可靠去重，不自動刪除。
- **規則評估**：保留既有受眾規則評分供參考，但明確改標「rule_heuristic，未呼叫 AI 模型」，不再把它稱作 AI 生成。社群文字格式化不補造時間、地點、hashtag 或圖片 alt text。

## 能力盤點與仍未完成

| 分類 | 實際範圍 |
| --- | --- |
| 已實作且本機驗證 | 閘道驗證、來源收藏、既有聊天／長任務、創作任務真實 HTTP 提交／查回／去重、官方 SDK 工具清單、角色事件、未知用量。 |
| 已實作但外部未驗證 | Hermes 適配器／Session Key／runs、Canva OAuth／上傳／Autofill／匯出；目前沒有新的已確認 Zeabur 實例與使用者授權證據。 |
| 缺少授權或端點 | 正式存取閘道與新秘密、Hermes API 網域／版本、新金鑰、Canva grant／範本、指定淡江與各專案 MCP/API。 |
| 只有規則或計畫，不是執行 | Audience Twin 規則分數、研究入口與 query plan、專案工具名稱映射、Canva spec 格式整理。不可稱作真正研究／市場測量／任意設計編輯。 |
| 尚未實作完整 | IG 發佈／排程／成效、Pinterest 官方搜尋、Canva 任意頁面修改、Hermes 記憶 CRUD、跨所有代理的工具費用預算。完整十三步網宣工作流仍未完成。 |

之前保存在 `wip-creative-before-intelligence` 的活动／多頁文案／素材管理補強尚未套進本分支；不能用那份舊工作目錄的 33 項測試或截圖聲稱 PR #11 已具備它們。這些資料保留供後續與最新專案結構整合，未刪除或覆盖。

## 驗證分層

- `npm test`：49 項，包括新增閘道拒絕、任意 MCP 目標／秘密配對拒絕、靈感跨專案及 ID 碰撞、真正 HTTP 創作任務、需求重試、用量去重、工具停止／範圍／預算與實際圖片解碼。Hermes／Canva 使用隔離協定伺服器，**不是實機平台驗證**。
- `npm run test:ui`：真實 Chromium，360／390／768／1440px、免登入、亮色、合成 IME、鍵盤／焦點、附件、瀏覽器儲存受限等；不是實體手機鍵盤。
- `npm run test:chat`：真實瀏覽器與 Console 程序，對隔離 Hermes 伺服器測長串流、重新整理、原生任務恢復、停止 HTTP 與避免重複提交。
- `npm run test:gateway`：真實瀏覽器 → 隔離代理服務 → 真實 production Console；以測試 cookie 模擬「已通過閘道的身份」，驗證無 Console 登入、後端直連拒絕、Origin 防護、秘密不傳入瀏覽器。**沒有驗證 Cloudflare Access／VPN／Zeabur 正式身份系統。**
- 型別檢查、正式建置、秘密掃描及套件稽核另執行。秘密掃描修正了舊檔已自 main 刪除時基線為空仍通過的問題；不等於部署端已撤銷舊金鑰。

## API 變更

`POST /api/intelligence` 必填 `prompt`、UUID `requestKey`，可帶 `projectId`、既有 `conversationId` 與最多 4 個已保存 attachment ID。移除客戶端 `tamkangReachable` 自我宣告欄位。成功為 202；結果保存在既有任務及對話，不會同步回傳假方向或假 Canva 成果。無 Hermes 設定回 503，保存的需求可用同一 requestKey 接續。

MCP 登記只能匹配 `CONSOLE_MCP_SERVERS_JSON` 的後端定義，或已配置的 TKU_MCP_URL／TOKEN。變更部署設定後再驗證，不能只點前端「新增連接」取得服務控制權。

## 接續所需設定（不要將秘密貼在對話）

1. 由部署端配置私人網路／真正身份驗證閘道，設定新的 CONSOLE_GATEWAY_SECRET，並限制 Console 後端直連。見 [部署說明](DEPLOYMENT.md)。合併前需完成這項部署準備，否則 API 會按設計拒絕存取。
2. 提供確認過的 Hermes API 網域、部署版本；新金鑰只置後端秘密儲存。先前公開憑證仍需部署管理者撤銷，本輪沒有代為輪替。
3. Canva OAuth grant、可用範本及方案；淡江／其他專案的真實 MCP 端點、credential reference 與讀寫範圍。GitHub URL 不是 MCP 端點。
4. 取得 IG/Pinterest 官方帳號權限後再補其未實作部分；一份可公開的活動需求供實例端到端驗證。正式發布須另外確認內容與時間。

官方依據：[Hermes API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/)、[MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)、[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。以實例回覆為準，不把最新文件當已部署能力。
