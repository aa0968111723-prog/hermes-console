# 活動工作流、學習地圖與電子信箱邀請制

本輪依最新要求，以電子信箱邀請登入取代免登入；尚未部署、寄出真實邀請或更動既有正式資料。現有 SQLite 工作區、對話與素材保留，沒有重寫 Git 歷史。

## 可以實際操作的內容

- 專案中建立活動資料、逐項核對來源及衝突；模型提出的資料一律待確認，私人欄位不提供給網宣 MCP 工具。這是已知私人值的阻擋與範圍控制，不是能識別所有個資的分類器。
- 持久化貼文、輪播、限動、短影音逐頁文案；保留原作品識別、修訂歷史與選定版本，可下載指定版本。修改第二頁不重建第一頁或重新搜尋。
- 透過真實 MCP 呼叫讀寫專案上下文、活動及文案，連結已選定的創作方向。使用者確認活動、選定方向和版本，不由模型自行確認。
- 設定 → 記憶：建立偏好、品牌視覺、知識、工作技能的樹狀關聯，保存版本、來源網址與最多四個專案素材。關聯代表使用者安排，不是熟練度、等級或自動解鎖。
- 使用者明確同意後，學習／忘記請求沿用 Hermes 任務執行管線、會話、附件與停止入口；同版本同動作重送沿用任務識別，沒有另外建立模型或背景自動學習。
- 設定 → 成員：只有管理員可寄出／重寄邀請與撤銷成員；一般成員不能使用管理 API。沒有公開註冊、共用密碼或前端登入繞過開關。

## 不冒充遠端記憶

Console 的節點是「希望學習的資料與提交紀錄」，不是 Hermes 記憶的鏡像。必須驗證實例列出的 memory／skills 工具，以及管理者確認的記憶範圍，才送出真實 Agent 任務。圖片沿用已支援的圖片輸入管線；未啟用影像能力或 PDF 未解析時不聲稱已讀。

任務完成後仍標示「待核對遠端結果」，`remoteVerified` 保持 false。模型只回覆「記住了」不能證明保存；忘記請求同樣不能宣稱已刪除。目前沒有經此部署版本驗證的記憶全文讀取／精準刪除 API，不提供假的同步成功。

失敗／中斷任務不自動重送有副作用的動作。同版本已提交的請求會返回原任務，需先查看紀錄；若要重新提交，先核對遠端結果並保存修訂版本。來源視為不可信資料，不能更改系統規範或增加工具權限；後端權限仍須由 Hermes 部署方限制。

## 邀請制設定與範圍

後端秘密儲存需設定：

- `CONSOLE_ORIGIN`：Console 的真實 HTTPS origin。
- `CONSOLE_ADMIN_EMAILS`：逗號分隔的管理員信箱。未設定時預設 `aa0968111723@gmail.com`。管理員可從入口要求自己的登入連結；移除管理員設定後，其舊登入連結與 session 失效，重新加入也不復活舊 session。
- `RESEND_API_KEY`：新產生的寄信服務金鑰。
- `CONSOLE_EMAIL_FROM`：Resend 已驗證網域下的寄件信箱。
- `CONSOLE_DATA_DIR`：單一 replica 的持久化私人資料卷；沿用既有資料，不清空。

登入連結 15 分鐘、一用即失效；只保存雜湊。連結 token 放在 URL fragment，頁面立即清除，必須按確認才核銷，GET 不會消耗連結。12 小時的 session 使用 HttpOnly、SameSite=Lax、HTTPS Secure cookie。每次受保護 API 都確認成員仍有效，撤銷同時廢止 session 與尚未使用的連結；不代表撤回已下載內容或自動停止先前執行中的任務。

寄信服務回傳成功只標示「服務已接受」，不是信箱已收到；服務錯誤不回傳原始錯誤或 token。公開登入回應不揭露成員名單。提供全域及每信箱限流；正式環境仍建議閘道／WAF 的來源限流，避免他人耗盡全域寄信額度。

可保留存取閘道作第二層保護，但通過閘道仍需受邀登入。MCP 使用獨立後端服務憑證，不依賴瀏覽器 cookie；不可將該憑證提供成員或模型對話。

**本版明確保留既有團隊共用工作區。** 成員可見同工作區專案、對話、素材與學習資料，尚未實作每位成員獨立資料租戶。邀請頁會提示授予共用資料存取。正式上線前須確認此範圍符合需求，不能宣稱個人記憶隔離。

## Hermes 與外部服務仍需的設定

1. 真實 Zeabur Hermes API origin、部署版本與已輪替的新憑證，驗證工具清單、記憶／技能作用範圍及重啟持久化。
2. 僅在上項完成後設 `HERMES_LEARNING_SCOPE_VERIFIED=true`；圖片輸入另需驗證後設 `HERMES_IMAGE_INPUT=true`。環境旗標是管理者聲明，不是 Console 自動驗證了底層隔離。
3. Hermes 配置 Console MCP 橋接與最小權限，使 Agent 能使用活動／文案工具；來源指令不能擴權。
4. Canva OAuth、帳號與可用品牌範本仍需實際授權；現有 Autofill 製作不是任意頁面編輯 API。本輪未執行真實 Canva 產出、社群發佈或遠端記憶刪除。

## 驗證方法

- `npm test`：65 個測試通過。包含真實 HTTP handler／MCP 協定與隔離 SQLite；Hermes、Canva、寄信供應商回應有明確測試 fixture，不是外部實機證據。
- `npm run build`：production build 通過。
- `npm run test:workbench`：真實本地 production 瀏覽器完成一次性連結核銷、防重用、登出、活動核對、兩頁文案修訂與下載、學習樹關聯及刷新恢復；登入身份由隔離測試資料庫建立，不寄信。
- `npm run test:ui`：四種寬度、IME、Shift+Enter、短視窗、減少動畫、對話草稿、鍵盤與焦點回復回歸通過；使用已受邀 session fixture。
- `npm run test:chat`：瀏覽器到真實 Console 再到隔離 HTTP 契約伺服器，驗證長串流、會話識別、重整、分支、原生任務持久化及停止 HTTP；不是 Zeabur 實測。
- `npm run test:gateway`：真實瀏覽器與受控 proxy fixture，驗證匿名、偽造閘道、跨來源寫入被拒絕，秘密未進瀏覽器請求／HTML／日誌；不是正式 SSO 驗收。
- `npm audit --omit=dev`：本輪回報 0 vulnerabilities；不代表程式或部署不存在安全風險。
- 產物在 `output/playwright/`：`invitation-mobile-390.png`、`workbench-mobile-390.png`、`learning-mobile-390.png`、`learning-desktop.png`。截圖是真實本地程式搭配隔離測試資料，不是正式 Zeabur 畫面。

SQLite 節點／修訂透過同一資料卷持久化；備份時停止唯一 Console 程序後備份完整資料目錄（含資料庫、WAL 如有、uploads），將備份保存在受控位置。還原至隔離環境先驗證，再由部署管理者批准切換；Hermes 自身記憶卷必須獨立備份與還原驗證。

## 官方介面依據

- [Hermes Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
- [Hermes Skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills)
- [Hermes API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [Canva Autofill](https://www.canva.dev/docs/connect/autofill-guide/)

文件描述不代表目前實例具備全部介面；以實際部署探索與執行證據為準。
