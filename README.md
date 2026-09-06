# Hermes Creative Intelligence

明亮、免登入的單一工作區。開啟網址即可與 Hermes 對話。Hermes 執行工具；Console 保存會話對應、任務與素材，不另建模板大腦。

## 啟動

需要 Node.js 22.13+，建議 Node.js 24 LTS。此版本需要持久化磁碟與單一長駐 Node 程序，不適用無狀態 serverless 環境。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`，依註解設定。
3. 設定經確認的 `HERMES_API_URL` 與全新 `HERMES_API_KEY`。禁止使用曾公開的舊金鑰。
4. 本機 loopback 開發明確設定 `CONSOLE_ALLOW_LOCAL_ACCESS=true`；正式環境保持 false 並配置存取閘道秘密。
5. `npm run dev`；正式環境使用 `npm run build` 與 `npm start`。

# No Login

開啟網站即可使用。不需要帳號、密碼、註冊或 session 登入閘。資料寫入固定後端 namespace `workspace`，不會在介面顯示。

正式環境必須經受控存取閘道：先驗證身份或私人網路權限，再由閘道覆寫 `X-Console-Gateway`。後端以全新 `CONSOLE_GATEWAY_SECRET` 驗證；沒有配置時 API 拒絕存取。秘密不可送到瀏覽器，也不能使用公開、無條件注入標頭的代理代替身份驗證。詳見 [部署說明](docs/DEPLOYMENT.md)。

## 重要安全操作

之前提交過的金鑰與管理密碼必須在部署端撤銷／更換。移除现行檔案不會清除 Git 歷史、快取或既有部署，也不代表憑證已撤銷。此分支不重寫歷史，不強制推送，不自動部署。

後端只使用管理者設定的 HTTPS 目標，拒絕重導向與瀏覽器傳入的服務網址或金鑰。Console 密碼不會提供給 Hermes。

## 驗證與限制

最新接續見 [PR #11 真實執行與閘道紀錄](docs/PR11_RELIABILITY.md)。契約測試使用明確隔離的測試伺服器，不是 Zeabur／Canva 實機整合驗證。
