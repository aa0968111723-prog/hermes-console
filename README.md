# Hermes Creative Intelligence

明亮、免登入的單一工作區。開啟網址即可與 Hermes 對話。Hermes 執行工具；Console 保存會話對應、任務與素材，不另建模板大腦。

## 啟動

需要 Node.js 22.13+，建議 Node.js 24 LTS。此版本支援零登入、任務持久化與 Hermes 雙引擎備援。

1. **深度連接 Zeabur Hermes Agent**：支援 `/v1/chat/completions` SSE 即時串流與本地雙引擎備援。
2. **全套生態系與 MCP 整合**：淡江大學校園生態 MCP、Canva 草稿藍圖、萬象靈感引擎與 Audience Twin 受眾雙生模擬。
3. **零登入安全工作區 (No-Login Single Workspace)**：免登入開啟即用，具備嚴格的 CSRF、Same-Origin 與速率限制防護。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`，依註解設定。
3. 設定經確認的 `HERMES_API_URL` 與全新 `HERMES_API_KEY`。禁止使用曾公開的舊金鑰。
4. `npm run dev`；正式環境使用 `npm run build` 與 `npm start`。

# No Login

開啟網站即可使用。不需要帳號、密碼、註冊或 session 登入閘。資料寫入固定後端 namespace `workspace`，不會在介面顯示。

若把 Console 網域直接暴露在公開 Internet，任何知道網址的人都可能消耗 Hermes／MCP 資源。請使用可選的部署層保護（Zeabur private networking、reverse proxy、Cloudflare Access、VPN、IP allowlist），不要在 Console UI 恢復登入。

## 重要安全操作

之前提交過的金鑰與管理密碼必須在部署端撤銷／更換。移除现行檔案不會清除 Git 歷史、快取或既有部署，也不代表憑證已撤銷。此分支不重寫歷史，不強制推送，不自動部署。

後端只使用管理者設定的 HTTPS 目標，拒絕重導向與瀏覽器傳入的服務網址或金鑰。Console 密碼不會提供給 Hermes。

## 驗證與限制

請參閱 `docs/DELIVERY.md`。契約測試使用明確隔離的測試伺服器，不是 Zeabur／Canva 實機整合驗證。
