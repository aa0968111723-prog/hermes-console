# Release checklist

每次 release 勾選。未完成標 Partial，不要打綠勾。

## Mobile

- [ ] 360×800、390×844、412×915、430×932、768×1024 可完整捲動
- [ ] Chat：只有 conversation-scroll 主捲動；Composer 可見
- [ ] 專案／靈感／Agent／設定可滑到最底
- [ ] Android 鍵盤：Composer 上移、送出可見、關閉後不留白
- [ ] Safe area：Dock／Composer／Modal 不被系統列擋住
- [ ] Bottom dock：對話／專案／靈感／Agent；設定在頭像／齒輪

## Auth

- [ ] 未登入先 Login，不先載工作區
- [ ] Google：有 Client 才可按；無 Client 顯示尚未完成設定
- [ ] 淡江：未設 Client 時停用；有 OIDC 設定才跳轉校方 IdP
- [ ] Email 註冊／登入／登出
- [ ] Magic Link／重設：僅在寄信已設定時可用
- [ ] 連結身分不會因 Email 相同自動合併
- [ ] 未授權 API 回 401／403，不是只藏按鈕

## Chat / Agent

- [ ] 首頁龜龜 +「今天想做什麼？」+ 輸入
- [ ] 自然語言任務會規劃並呼叫工具（需 Hermes 連線）
- [ ] 一般 UI 不顯示 toolCallId／JSON schema
- [ ] 停止會打後端 cancel
- [ ] 離線顯示離線；重連不同步假裝任務已停

## MCP

- [ ] 未設定 = unconfigured
- [ ] 不可達 = failed
- [ ] 只有 listTools = partial；安全讀取有內容才 verified
- [ ] 無 token = unconfigured
- [ ] 不假裝搜尋了整個 Instagram

## Artifacts / Memory

- [ ] 作品有 artifactId／revisionId；改「第二版」不另起無關作品
- [ ] 專案上下文含名稱與最近作品版本（不含 preview JSON）
- [ ] 專案卡片有縮圖；PDF 顯示標示封面，不是假裝已擷取頁面
- [ ] 記憶 scope 標示清楚；舊記憶 confidence 會隨時間下降
- [ ] 讀取工具 429 可重試；發佈／刪除不會自動重送

## DB / Security

- [ ] 備份 SQLite 或 Postgres（`npm run backup`；Postgres 另需 pg_dump）
- [ ] 無 secret 進 git／log／health
- [ ] Origin、SSRF、session cookie 仍在

## Tests / Deploy

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Playwright：entry／ui／chat／workbench／gateway／runtime
- [ ] `/api/live` 200、`/api/ready` 反映儲存、未登入 `/api/health` 無密鑰且無技能目錄
- [ ] Rollback 路徑已寫在 PRODUCTION.md
