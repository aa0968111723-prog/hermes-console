# Hermes Creative Intelligence

明亮、電子信箱邀請制的團隊工作區。Hermes 執行工具；Console 保存會話、任務、活動、文案版本與學習請求，不另建模板大腦。

## 啟動

需要 Node.js 22.13+，建議 Node.js 24 LTS。此版本需要持久化磁碟與單一長駐 Node 程序，不適用無狀態 serverless 環境。

1. `npm ci`
2. 複製 `.env.example` 到 `.env.local`，依註解設定。
3. 設定經確認的 `HERMES_API_URL` 與全新 `HERMES_API_KEY`。禁止使用曾公開的舊金鑰。
4. 設定 `CONSOLE_ADMIN_EMAILS`（未設定時預設初始管理員 `aa0968111723@gmail.com`）、`RESEND_API_KEY` 與已驗證寄件網域的 `CONSOLE_EMAIL_FROM`；用管理員信箱要求一次性登入連結。沒有公共註冊或正式環境登入繞過。
5. `npm run dev`；正式環境使用 `npm run build` 與 `npm start`。

## 電子信箱邀請制

管理員設定於後端環境變數 `CONSOLE_ADMIN_EMAILS`（未設定時預設 `aa0968111723@gmail.com`），登入後在「設定 → 成員」邀請或撤銷成員。登入連結 15 分鐘有效、一次性使用，會話 12 小時有效；撤銷即阻止後續 API 存取。資料仍寫入原 `workspace`，保留既有歷史。目前成員共享資料，不宣稱個人隔離。

可另外保留受控存取閘道：設定 `CONSOLE_GATEWAY_SECRET` 後後端同時要求閘道與受邀會話；閘道不能取代邀請登入。詳見 [部署說明](docs/DEPLOYMENT.md)。

## 重要安全操作

之前提交過的金鑰與管理密碼必須在部署端撤銷／更換。移除现行檔案不會清除 Git 歷史、快取或既有部署，也不代表憑證已撤銷。此分支不重寫歷史，不強制推送，不自動部署。

後端只使用管理者設定的 HTTPS 目標，拒絕重導向與瀏覽器傳入的服務網址或金鑰。Console 密碼不會提供給 Hermes。

## 驗證與限制

最新接續見 [活動、學習地圖與邀請制](docs/LEARNING_INVITATIONS.md)。舊 PR #11／#14 文件僅為歷史紀錄，其免登入方案已由本輪要求取代。契約測試不是 Zeabur／Canva／電子郵件收件匣的實機驗證。
