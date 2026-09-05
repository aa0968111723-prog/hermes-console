# Hermes 創作助手

明亮、受保護的 Hermes 對話工作區。Hermes 執行工具；Console 保存會話對應、任務與素材，不另建模板大腦。

## 啟動

需要 Node.js 22.13+，建議 Node.js 24 LTS。此版本需要持久化磁碟與單一長駐 Node 程序，不適用無狀態 serverless 環境。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`，依註解設定。
3. `npm run password:hash` 建立新的登入密碼雜湊。
4. 設定經確認的 `HERMES_API_URL` 與全新 `HERMES_API_KEY`。禁止使用曾公開的舊金鑰。
5. `npm run dev`；正式環境使用 `npm run build` 與 `npm start`。

所有操作需要登入。目前為單一擁有者的私人工作區：不開放註冊，不把共享 Hermes 記憶冒充多租戶隔離。

## 重要安全操作

之前提交過的金鑰與管理密碼必須在部署端撤銷／更換。移除现行檔案不會清除 Git 歷史、快取或既有部署，也不代表憑證已撤銷。此分支不重寫歷史，不強制推送，不自動部署。

後端只使用管理者設定的 HTTPS 目標，拒絕重導向與瀏覽器傳入的服務網址或金鑰。Console 密碼不會提供給 Hermes。

## 驗證與限制

請參閱 `docs/DELIVERY.md`。契約測試使用明確隔離的測試伺服器，不是 Zeabur／Canva 實機整合驗證。
