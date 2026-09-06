## PR #11 接續：真實 Hermes 任務、工具執行與存取閘道

基於已合併 PR #11 (`7efcc06`)；依使用者本輪明確選擇「免登入＋受控存取閘道」。不部署、不合併其他未審分支、不發佈社群。

### 修改

- 工作區 API 以後端 gateway secret 驗證；未設定 fail closed。前端維持免登入，不取得秘密。
- 移除 intelligence 固定三方向／假研究來源／虛構日期地點，改用現有 Hermes durable task，保存參考與需求、查回真實輸出、去重與接續。
- MCP 端點／憑證配對只允許後端核准清單；官方 SDK 正確初始化／工具清單，不自行猜讀取工具執行。
- MCP 真實 taskId、專案範圍、停止後拒絕、持久化次數预算、tool call ID、結構化授權錯誤；新增真實圖片／TXT 讀取。
- 靈感 URL／專案 ID 碰撞與錯誤去重修復、已保存靈感接入工作區工具；未讀圖／未授權不假裝可用。
- 同一任務用量不重複累加；未知工具用量不作零。受眾模擬明確標為規則計算，沒有呼叫 AI 模型。
- 修正秘密掃描缺失歷史基線仍通過的問題，保留歷史，不使用舊憑證。

### 驗證

- 49 項後端／官方 SDK／HTTP 契約與角色測試。
- 型別檢查、正式建置、秘密掃描、npm audit。
- 真實 Chromium：360／390／768／1440px；免登入、亮色、合成 IME、附件、長任務、停止、恢復。
- 真實瀏覽器 → 隔離 gateway fixture → production Console：拒絕直連／偽造標頭，秘密不進瀏覽器。這不是正式 SSO/VPN 驗證。
- 新截圖 `docs/screenshots/gateway-desktop.png`、`gateway-mobile-390.png`。

### 必要部署準備與限制

**先保持 Draft。合併前需準備真正的閘道身份／網路政策與新 gateway secret；否則 API 會按設計拒絕存取。** 公開且無條件加入標頭的 reverse proxy 不是身份驗證。

尚未有 Zeabur Hermes 新憑證／版本確認、Canva 使用者授權／範本與指定淡江／專案端點，未完成實例網宣端到端。IG 發佈／排程／成效、Pinterest 官方搜尋、Canva 任意頁面編輯、Hermes 記憶管理仍未完整實作。

完整能力分類、API 變更與精確需求：[PR11_RELIABILITY.md](docs/PR11_RELIABILITY.md)、[DEPLOYMENT.md](docs/DEPLOYMENT.md)。
