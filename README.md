# Hermes Console (柯能中央大腦控制台)

柯能 / Bruce 的中央大腦 Hermes Agent 控制中樞與對話前端，深度連接 Zeabur 雲端服務。

## 🌟 核心功能

1. **深度連接 Zeabur Hermes Agent**：
   - 伺服器端點：`/v1/chat/completions` (SSE 即時串流支援)
   - 內建預設 API Server Key：`Xn7KpRg8w2vr91aHdeWoIDmTf6Jx0354`
   - 管理儀表板帳號：`admin` / 密碼：`Xn7KpRg8w2vr91aHdeWoIDmTf6Jx0354`
   - 連線健康檢測與 Ping 延遲回報。
2. **全套生態系工具箱 (Full Tool Use)**：
   - `get_ecosystem_projects`：即時檢索 41 個專案目錄與狀態。
   - `inspect_project`：查詢指定專案之架構細節與 GitHub 儲存庫。
   - `get_zeabur_dashboard_info`：調閱 Zeabur 儀表板連接資訊。
   - `check_hermes_status`：大腦在線狀態與工具管線檢測。
   - `generate_creative_brief`：產出 16:9 分鏡鏡頭與海報視覺規格。
   - `run_text_transform`：繁體中文切句、分鏡鏡頭拆解編號。
3. **雙工作區模式**：
   - **指揮中樞 (Console Cockpit)**：專業工程指揮艙，支援專案上下文、思維推導 (CoT)、工具調用追蹤與歷史對話管理。
   - **創作小天地 (Jie's Atelier)**：粉彩靈感模式，包含倢的互動舞台。

## 🚀 快速啟動

```bash
# 1. 安裝依賴
npm install

# 2. 開發模式
npm run dev

# 3. 生產編譯
npm run build
```

## 🛠️ Zeabur 連線指引

1. 在 Zeabur 專案管理面板，為 `hermes-agent` 服務綁定一個公開網域（例如 `https://hermes-agent.zeabur.app`）。
2. 在 Hermes Console 右上角點擊「Zeabur 連線設定」，填入該網域並點擊「儲存連線設定」。
3. 點擊「即時 Ping 測試」確認連線顯示 🟢 綠燈即可全面啟動 Hermes 大腦！
