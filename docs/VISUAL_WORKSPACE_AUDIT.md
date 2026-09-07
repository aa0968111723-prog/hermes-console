# Visual-first Hermes Workspace：UI 稽核與交付

## 基準與範圍

- PR：[#34 — feat: visual-first 3D Hermes workspace](https://github.com/aa0968111723-prog/hermes-console/pull/34)。
- 分支：`feat/visual-first-3d-workspace`。
- 已執行 `git pull --ff-only`、重新 fetch main；本輪結束前 main 仍為 `b3059a96ad8828c7fcf4aa56ec64c6c9e1864378`（GALLEY PR #24 merge）。
- 已檢查近期 Agent OS、GALLEY、FrameLab、Lumen 合併。相對 main，`lib/server` 與 `app/api` **沒有修改**。既有 MCP、Runtime、Memory、Projects、授權、任務、用量、文案修訂與執行契約保留。
- 延續最新 main 的免登入共用工作區。這不是新增公開存取授權；正式站仍須受控網路／存取閘道。未進行正式部署、發文或 PR 合併。

## UI audit：文字與操作

| 範圍 | Before | After／細節去向 |
| --- | --- | --- |
| HermesConsole 首頁 | 歡迎 eyebrow、两段教學、開始使用 CTA、六個長標籤 | 一句問題、龜龜、六個 2 字圖像動作；實際 prompt 不刪除 |
| 導覽 | 固定文字側欄；前一版 hover 展開但隱藏歷史仍可聚焦 | 桌面圖示 dock，明確展開／收合按鈕；收合歷史不進焦點順序；手機四個主要入口直接可見 |
| Composer | 加入素材、模式名稱、永久鍵盤 footer；上一版用 CSS 藏掉素材入口 | +／輸入／送出，同一列；+ popover 可選圖片、文件、參考、Canva、專案素材；鍵盤與權利提示保留在輔助描述與按需流程 |
| Projects／ProjectWorkbench | 活動表單先於素材，專案是文字列表 | 實際圖片封面 ProjectShelf；活動與文案折疊後保留所有表單／確認／版本／匯出；參考匯入按需展開 |
| 訊息與工具 | 工具技術文字、Markdown 結果 | 去重的真實 toolCallId 計數、來源卡、可展開執行紀錄；不生成信心分數或來源縮圖 |
| Turtle／AgentActivity | 最新一筆工具事件；上一版任務一開始便點亮多個假步驟 | 共同事件判定 helper；依 call ID 合併更新；完成、取消、等待、失敗優先於舊 running 事件 |
| agents/* | Agent 卡片清單，configured 也顯示成功勾 | 真實 Runtime MCP 節點圖；原 Agent OS 設定檔按需展開；設定存在不冒充可執行，模型及未知用量在詳情保留 |
| RuntimeInspector | schema、快照與診斷資訊先顯示；上一版收到 snapshot 就把 Hermes 變綠 | 人類健康摘要；憑證有效且 Agent 有驗證才為綠；過期不為綠；Advanced 保留分組、工具權限、schema、診斷 |
| settings/* | 連續 URL／Token／技術說明；多份整合清單 | IntegrationGrid 點一項才顯示該項表單；Canva 原授權流程也在 grid；健康、vault 細節、能力證據與技能索引獨立展開 |
| inspiration/* | 原始來源資訊偏文字清單 | 原始來源圖卡／icon／標題先顯示，metadata 與使用限制按需展開；沒有實際影像的來源不偽造圖片 |
| 成果 | 單純連結；上一版 Stage 有無動作的省略按鈕、任務頁沒有入口 | 任務與成果有 topbar 入口；真實 Canva 預覽、有效編輯連結、帶 workflow ID 的對話接續；移除無動作按鈕 |
| globals.css | 重複色碼、視覺覆蓋混在舊 CSS | 新區段集中 surface/depth/motion/focus/spacing/type/z-index tokens，既有主要品牌色引用 tokens；保留未遷移功能樣式 |

### 實際刪除／移至按需顯示的文字

刪除首頁常駐「歡迎使用 Hermes Creative Intelligence」「直接告訴龜龜你想做什麼」「不必自己挑選工具」「開始使用」；移除 composer「Hermes · 草稿工作區」及重複常駐 CTA。六個原有長標籤改為「研究／創作／分析／客群／靈感／設計」，點擊仍填入實際任務要求。工程名稱、來源詳情、憑證儲存機制、執行證據不是刪掉能力，而是移到相應詳情。

可重現的文字計量：main 首頁歡迎區的標題、說明、CTA、六個 action label（排除空白、龜龜說明、導覽、composer、tooltip）由 **117 字元 → 19 字元，減少 83.8%**。這只是首頁特定區域，**不能外推為全站減少 40～60%**；全站逐畫面相同狀態的基準計量尚未完成。

## 3D／動態系統

- CSS perspective + rotateX／rotateY；龜龜滑鼠傾斜限制 ±2°／±3°，卡片最多 ±2°、translateZ 6px。
- canvas／ambient／surface／card／active／overlay／modal 深度層；contact shadow、柔和綠／金色照明、珠白表面。沒有新增 Three.js、WebGL 或每卡 requestAnimationFrame。
- Orbit 節點來自 integrations 或 Runtime mcpServers；工具映射使用 canonicalName／server ID，沒有硬塞可用能力清單。節點可用滑鼠與鍵盤打開詳情。
- beam 與 activity 只在後端仍為執行狀態、有對應工具事件時作用；狀態過期停止高亮。沒有隨機搜尋或自動完成動畫。
- 手機不做連續手指傾斜。龜龜可隱藏、調大小、關動畫；背景分頁暫停非必要動畫，prefers-reduced-motion 停止動畫與傾斜。
- 新元件：AppDock、HermesCore、QuickActions、ComposerMenu、ContextTray、ProjectShelf、AgentActivity、AgentOrbit、ArtifactStage、IntegrationGrid、VisualMessage、VisualStatus。沒有一次改寫所有聊天生命週期。

## 驗證紀錄（本機 Chrome／production build）

| 檢查 | 結果 |
| --- | --- |
| ESLint | 通過；真正的前端語意／ARIA／Next 規則，不再以 typecheck 假充 lint |
| TypeScript | 通過 |
| 單元／契約測試 | 148 通過，包括三個新的真實事件狀態與安全來源測試 |
| production build | 通過；首頁 First Load JS 約 208 kB；修正 Windows worktree root tracing 設定 |
| verify-ui | 通過 360、390、430、768、1024、1440px；2／3／6 欄 action；send／dock 邊界；無水平溢位 |
| 無障礙 | axe WCAG 2 A／AA、2.1 A／AA：10 個受測狀態 0 violations；不是人工讀屏全面認證 |
| 鍵盤／觸控 | IME Enter 不送出、Shift+Enter 換行、對話分支、44px send／dock／orbit、縮短 viewport、焦點回復、popover Escape、設定 tabs、reduced-motion 通過 |
| 真實 Console 資料 | 圖片上傳／實際解碼預覽、持久化參考、專案封面、分流草稿及附件、儲存禁用環境均通過 |
| verify-chat | 隔離 HTTP Hermes 契約服務：串流、重啟查回任務、session、保留原對話分支、停止確實送達 HTTP，通過 |
| verify-workbench | 實際 Console 後端：活動事實確認、兩頁文案兩版、舊版不覆蓋、下載、學習資料持久化，通過 |
| verify-gateway | 隔離 proxy 身分 fixture + 實際 Console：直接／偽造／跨來源請求拒絕、秘密不入瀏覽器，通過；不是正式閘道驗證 |
| secret scan | 通過目前 source／build 的既有秘密偵測；不代表 Git 歷史清除或部署端憑證已撤銷 |

有一次同時執行多組瀏覽器測試時，verify-chat 的 15 秒串流完成等待逾時；原因尚未完全確定。其後**不變更程式、不延長逾時**，單獨重跑通過。CI 按序跑各瀏覽器套件；此紀錄不隱藏為「從未失敗」。

### 效能

正確以 PerformanceObserver 取得數據，取代不支援的 getEntriesByType 量測。隨附本機未限速、暖載入報告：LCP **232 ms**，CLS 累計 **0.00008027**。CLS 是排除 recent input 的原始累計，不是正式 session-window field CLS。此結果不是行動網路、低階實機或 Zeabur 的 p75；不能據此保證實際 LCP <2.5 秒或 60fps。

CI 新增 lint、typecheck、Chrome UI／chat／workbench／gateway，並上傳 browser evidence。UI 回歸包含預設文字长度、欄數、可見性、權限狀態、焦點、圖片解碼、來源 URL、artifact 接續 ID 與截圖；**尚未採用跨作業系統逐像素 diff**。

## 截圖

截圖是在真正的 Chrome 中跑 production Console。下列名稱含 fixture 的檔案及畫面有明確「介面測試」字樣，**只驗證視覺與互動，不代表 GALLEY／Canva 真實製作成功**。

- [手機首頁](screenshots/visual-workspace/home-mobile.png)／[桌面首頁](screenshots/visual-workspace/home-desktop.png)
- [手機專案](screenshots/visual-workspace/projects-mobile.png)／[桌面專案](screenshots/visual-workspace/projects-desktop.png)
- [圖片上傳 context](screenshots/visual-workspace/context-mobile.png)／[真實圖片預覽](screenshots/visual-workspace/image-preview.png)
- [手機連線](screenshots/visual-workspace/settings-connections-mobile.png)／[桌面連線](screenshots/visual-workspace/settings-connections-desktop.png)
- [Canva 未設定](screenshots/visual-workspace/canva-unconfigured.png)／[Agent](screenshots/visual-workspace/agents.png)／[Runtime Advanced](screenshots/visual-workspace/runtime-advanced.png)
- [聊天 fixture](screenshots/visual-workspace/chat-fixture.png)／[工具執行 fixture](screenshots/visual-workspace/tool-running-fixture.png)／[成果 fixture](screenshots/visual-workspace/artifact-fixture.png)
- [失敗 fixture](screenshots/visual-workspace/error-fixture.png)／[離線手機](screenshots/visual-workspace/offline-mobile.png)
- [量測與無障礙原始結果](screenshots/visual-workspace/browser-report.json)

## 尚未完成／尚未驗證

1. Zeabur Hermes、GALLEY、Canva、淡江等正式服務的實機驗收需要現行受控網址、授權和可用測試帳號；本轮没有接觸正式憑證或將待授權標為可用。
2. 低階手機實機、真實虛擬鍵盤、VoiceOver／TalkBack、部署站 LCP／CLS／60fps 尚未驗證。
3. 跨作品 A／B／C 視覺比較、版本堆疊尚未新增；現有文案版本與方向選擇保留，成果接續帶實際 workflow ID。沒有新增無動作的比較／匯出按鈕。
4. PDF 頁面、網站 OpenGraph 及無影像來源，現有後端未提供可用縮圖時仍以文件／來源圖示呈現，不偽造 preview。沒有新增 OCR 或縮圖後端。
5. 全站 40～60% 文字減量、完整舊 CSS token 遷移、剩餘大型元件拆分仍為後續工作；本 PR 不宣稱已滿足原始 29 項的每一細節。
