# Release checklist

每次 release 勾選。未完成就標 Partial，不要打綠勾。

## Mobile

- [ ] 360×800、390×844、412×915、430×932、768×1024 可捲動（聊天與專案）
- [ ] Composer 不被鍵盤／Home Indicator／Android 導覽列擋住
- [ ] Dock：對話／專案／靈感／Agent；設定在齒輪／頭像；漢堡是對話列表
- [ ] 預覽關閉後仍可繼續滑

## Auth

- [ ] 預設免登入進入工作區。只有 `CONSOLE_AUTH_REQUIRED=true` 才看到登入閘
- [ ] Google Authorization Code 真的跳轉 Google
- [ ] 淡江：有 metadata 才跳校方 IdP；否則「尚未完成設定」；Console 不收集學校密碼
- [ ] Email 註冊／驗證／magic link／重設／登出；`/#reset=` 可輸入新密碼
- [ ] 已登入後可連結 Google／淡江／Email；登出後用任一已連結方式回來仍是同一 User
- [ ] 連結身份不會因 email 相同而自動合併
- [ ] 連線密鑰變更限 owner／admin
- [ ] 帳號頁可看到工作階段；結束其他裝置要確認
- [ ] 無 membership 不能打工作區 API

## Chat / Agent

- [ ] 使用者只說目標，不必選工具
- [ ] 360px 靈感方向 A／B／C 可在同一列橫滑到達，不必把 C 壓到 composer 下面
- [ ] 方向卡／規格在對話可視區時不顯示「回到最新訊息」
- [ ] 360px 靈感頁第一屏是方向卡，不是 A4 規格或 Drive 知識；Drive 知識預設摺疊
- [ ] 切換 Dock 分頁（任務→靈感／專案）從頁頂開始，不沿用上一頁捲動
- [ ] 工具失敗顯示不可用或明確 fallback，不假裝有資料
- [ ] 工具 HTTP 200 但內容為空記為失敗，不是完成
- [ ] 取消會打後端 cancel
- [ ] 長任務重啟後不是假 running（立刻 reconcile 為 uncertain）
- [ ] 未開 `HERMES_IMAGE_INPUT` 時附圖不假裝已分析；「這張哪裡可以改」可走工作區模擬並標明沒有讀像素
- [ ] Hermes 未連線時，工作臺「寫 A／B／C」「整理三個方向」與 Composer／Dock Canva 查回停用，不 503
- [ ] 規格框顯示語氣與「海報 A4」，不露出紙張比例 `210:297`
- [ ] Agent 分頁一般檢視只顯示 Hermes／記憶／工具／MCP 狀態，開發者才看工具清單與節點設定檔
- [ ] 任務頁選方向不把「缺授權／阻塞點」寫進聊天輸入框

## MCP

- [ ] 每個已設定 MCP 的真實狀態（unconfigured／partial／failed／available）
- [ ] 未設 token 不是綠燈

## Artifacts / Memory

- [ ] 作品有可接續的 ID；「第二版」不是無關重生
- [ ] 選定方向的規格草稿會進任務頁作品舞台（workspace artifact），不得標成 Canva 已出圖
- [ ] 「第二版字放大」改同一件規格的 V2，不是無關重生，也不是假出圖
- [ ] 任務頁接續修改會回到該作品的對話；送出「請接續修改同一作品」不 503、不另開版本
- [ ] 專案活動與文案「在對話接續修改」不把 tool／UUID 塞進輸入框
- [ ] 多版本可並排預覽（不是像素 diff）後再還原
- [ ] Memory 分得清對話／專案／工作區（Partial 則寫明）

## DB / Security

- [ ] 備份 Postgres 或 SQLite 卷
- [ ] 無 secret 進 Git／log／client
- [ ] Origin、SSRF、OAuth state 仍有效

## Tests / Deploy

- [ ] `npm run lint` `typecheck` `test` `build`
- [ ] CI GitHub Actions 全過
- [ ] `GET /api/ready`、`GET /api/health` 不回秘密；health 不等待 Hermes；agentReady 與 App 存活分開
- [ ] 回滾步驟已確認
