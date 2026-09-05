# 實作交付與驗證紀錄

## 目前交付範圍

本分支是可審查的實作，不是已完成所有實機整合的宣告。沒有取得新的 Zeabur 憑證或外部帳號授權，也沒有進行正式部署或社群發佈。

### 第一階段：安全、連線與任務

- 移除公開秘密預設值、前端金鑰欄位、模板 local-brain、XML 文字工具執行、假 ONLINE、寫死服務連線及專案數。
- 更新 Next.js／React 與有安全問題的相依套件；部署端仍須撤銷所有舊憑證。
- 單一擁有者登入、scrypt 密碼雜湊、HttpOnly／SameSite session、API 端驗證、Origin 檢查、持久化請求限制。
- HTTPS 服務由後端受控設定；不接受客戶端 baseUrl／apiKey；禁止重導向攜出 Authorization。
- 模型清單驗證、實例能力探索、工具／技能清單；明確區分服務可達、憑證有效、Agent 曾成功執行與各工具證據。
- SQLite 保存專案、會話、任務、來源、素材、工具事件及使用量。瀏覽器只保存外觀和目前對話識別。
- 支援 Hermes runs 之提交、查回及停止；只有實例宣告對應能力時啟用。背景監測器執行期限及恢復查詢。
- 舊版 chat-completions 使用完整後端歷史及真正圖片內容；串流被中斷後標示結果未確認，不假裝已停止遠端工具。
- 連線建立、串流閒置、整體期限分開。提交識別去重，未知結果不自動重送。
- 匯入舊瀏覽器對話不覆蓋原快取，明確標記舊助理回覆未經驗證；編輯建立新分支。

尚未實機驗證：Zeabur 真實網域、新金鑰、版本及實例能力；原生會話讀取格式；Hermes 重啟後任務／記憶持久性。一般訊息分支以完整內容建立新 Hermes 會話，不宣稱已執行原生 session fork。

### 第二階段：創作流程與工具

- 提供實際 Streamable HTTP MCP 介面（JSON-RPC 初始化、工具清單、工具呼叫、錯誤與獨立後端憑證），已用官方 MCP SDK 客戶端驗證。
- Hermes 可查詢 Console 專案參考素材、保存三個包含主張／視覺／文案／CTA／來源的方向。
- 選擇方向只能經已登入使用者的 UI/API，模型無選擇工具。保存後可接續製作。
- Canva Connect 實作 PKCE、一次性 state、綁定原登入 session、加密 token 保存、序列化 refresh-token 更新。
- Canva 設計搜尋／讀取、圖片上傳及工作查詢、範本資料集、選定方向後 autofill、製作結果查詢、匯出及下載連結查詢。
- 空白設計或工作 ID 不會被稱作完成成果。讀取清單成功只代表部分可用；製作／匯出需個別證據。
- 未取得授權時，Canva 工具不列為可執行。製作意外斷線保留不確定狀態，不重送外部副作用。

尚未完成實機端到端案例：缺 Hermes 實例授權、Canva OAuth 使用者授權、可 autofill 範本及活動需求。契約測試中的三個方向及 Canva 工作資料明確為測試資料，不出現在正式初始畫面。

### 第三階段：介面與龜龜

- 固定明亮配色，對話／素材／任務導覽；專案／歷史在側欄，設定與結果按需展開。
- 手機單欄、抽屜與底部面板，visualViewport 高度、安全區、44px 主要操作。
- Markdown、表格、來源連結、訊息複製、停止、重試分支、附件預覽及上傳進度／重試。
- 字級、阅读寬度、緊湊間距、側欄、龜龜顯示／大小／動畫可調整。
- 使用附件角色製作有 alpha 通道的透明素材；保留嫩葉、黃腹甲及深綠龜殼。不以 Emoji 取代。
- 小型龜龜從真實任務與工具事件切換狀態；背景分頁暫停動畫，尊重 prefers-reduced-motion。沒有餵食、升級、假眨眼或假思考。

已執行真實 Chromium 瀏覽器驗證：1440×1000、768×1024、390×844、360×800；登入、未登入 API、固定亮色、減少動畫、合成 IME 組字事件不送出、Shift+Enter、輸入按鈕邊界、龜龜邊界、抽屜、來源保存與重新整理、隱藏龜龜偏好。

這些為桌面瀏覽器的 viewport 驗證，不是實體 iPhone／Android 或真實中文輸入法／虛擬鍵盤驗證。仍需實機檢查 Safari 鍵盤、安全區與網路切換。

### 第四階段：外部平台狀態

| 能力         | 實作／目前限制                                                                         |
| ------------ | -------------------------------------------------------------------------------------- |
| Hermes       | 有真實後端適配器；實例未提供新設定，未實機連線                                         |
| Canva        | 有 Connect OAuth、MCP 草稿工具與非同步工作查詢；未取得授權、未實機製作                 |
| Instagram    | HTTPS 參考匯入、圖片／文案草稿流程；未實作正式發佈，不提供假發文按鈕、不承諾全站搜尋   |
| 淡江 MCP     | 從 Hermes 實際工具清單識別；指定倉庫／端點未提供，未宣稱課務工具包含所有淡江資料       |
| 專案 MCP/API | Console 提供自身專案／參考／創作 MCP；其他專案服務未提供，不把 GitHub 網址當可控制服務 |
| Pinterest    | Pin／看板來源連結收藏與專案範圍；搜尋、原站預覽資料擷取尚未授權／實作                  |
| 網宣靈感     | 真實 Hermes 對話提示與持久化三方向／選定／Canva 接續流程；需實機來源及設計工具完成驗證 |

## 測試命令

- `npm test`：後端、MCP 官方客戶端與 Canva HTTP 契約測試。
- `npm run typecheck`
- `npm run build`
- `npm run test:ui`：需要已安裝 Chrome；啟動隔離的真實 Console，不使用任何 Hermes／Canva 金鑰。產出 `output/playwright/` 截圖。
- `npm run test:chat`：真實瀏覽器→Console→隔離 Hermes 協定伺服器，驗證長串流、重新整理、Console 程序實際重啟後查回原生任務、停止 HTTP 請求及不重複提交。不是 Zeabur 實機驗證。
- `npm audit`
- `npm run check:secrets`：唯讀比對舊提交中的秘密字串與現行來源／前端產物；不輸出秘密，並不代表部署憑證已撤銷。

## 必要設定與一次性需求清單

本地結果：20 項後端／MCP／Canva 契約測試通過；上述兩套瀏覽器檢查通過；正式建置與型別檢查通過；套件稽核 0 項已知漏洞；秘密比對掃描通過。CI 結果以 PR 中的執行紀錄為準。

截圖見本目錄的 screenshots：desktop、tablet、mobile-390、mobile-360。畫面取自真實 Console，顯示未設定的外部服務狀態，不含假會話／假完成卡。

1. 經 Zeabur 確認的 Hermes API 網域、目前部署倉庫／版本；在部署秘密中設定全新的 HERMES_API_KEY，切勿在對話貼上。
2. 撤銷／輪替所有之前公開的 Hermes API 金鑰與管理後台密碼；確認舊部署、前端快取及建置產物不再含秘密。此分支未執行撤銷。
3. Console HTTPS 網域、單一 replica、可寫持久化磁碟；CONSOLE_ORIGIN、CONSOLE_USERNAME、CONSOLE_PASSWORD_HASH。
4. Hermes 目前 profile 的工具權限清單及記憶儲存卷。建議此 Console 專用 read/draft-only profile。文字提示不是權限沙箱；必須在 Hermes 端停用不應對外發佈／執行的工具。
5. Canva Connect 的 Client ID／Secret、OAuth redirect URI、使用者授權，以及可用 Brand Template ID／方案。Autofill 受官方方案与權限限制；不能把沒有權限當成功。
6. 保存在秘密儲存的 CONSOLE_VAULT_KEY；必須跨重啟保留，遺失將無法解密既有 OAuth token。
7. Hermes 可達的 Console MCP HTTPS 網址及独立 MCP_BRIDGE_TOKEN。將其以後端服務設定接入 Hermes，不放前端、不放公開 config。
8. 淡江 MCP 倉庫／端點／必要授權及公私資料範圍；其他專案 MCP／API 的實際服務端點與文件。
9. IG 專業帳號與官方授權範圍、Pinterest 官方授權／搜尋權限；正式發佈將另需目標帳號、媒體、文案與時間的逐次確認及發佈專用去重流程。
10. 一份可供實際跑通的活動需求與選定素材，以驗證來源→三方向→選定→Canva→IG 草稿。

## 官方依據

- [Hermes API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/)：依實例 capability 探索 runs、sessions、tools，不能將最新文件當已部署能力。
- [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/)：工具註冊留在 Hermes，Console 不解析文字標籤執行。
- [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)：JSON-RPC 傳輸、Origin、版本與通知回應。
- [Canva OAuth](https://www.canva.dev/docs/connect/authentication/)：[Autofill](https://www.canva.dev/docs/connect/autofill-guide/)、[素材上傳](https://www.canva.dev/docs/connect/api-reference/assets/create-asset-upload-job/)、[匯出](https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/)。
- [Meta 官方 Instagram API collection](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00)：專業帳號與實際權限限制；不是任意全站搜尋。
- [Pinterest API](https://developers.pinterest.com/docs/getting-started/make-an-api-call/)：成功 API 請求才作為授權／功能驗證依據。
