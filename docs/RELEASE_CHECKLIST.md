# Release checklist

每次 release 逐項打勾。不能打勾的項目必須標 **Partial**，禁止改成綠色完成。

## Mobile

- [ ] 360×800、390×844、412×915、430×932、768×1024 可完整捲動
- [ ] Chat：只有 conversation-scroll 是主捲動；Composer 不被鍵盤擋住
- [ ] 鍵盤關閉後高度恢復，不留白
- [ ] Dock／Composer 不被系統 Home Indicator／Android navigation 擋住
- [ ] 專案頁滑到底 → Preview → 關閉 → 繼續滑 → 回對話 → 打字送出

## Auth

- [ ] 未登入只看到 AuthGate，不載入工作區資料
- [ ] Google Authorization Code + PKCE（或誠實顯示尚未完成設定）
- [ ] 淡江跳轉正式 IdP（或「淡江 SSO 尚未完成設定」）
- [ ] Email 註冊／登入／驗證／Magic Link／重設／登出
- [ ] 帳號連結不會因 Email 相同自動合併
- [ ] 無 membership 的使用者進不了私人 Workspace API

## Chat / Agent

- [ ] 使用者不必自選 GALLEY／Canva／Lumen
- [ ] 工具失敗不假裝有資料
- [ ] 停止按鈕會打到後端 cancel
- [ ] 長任務重啟後不是假 running

## MCP

- [ ] Registry 狀態與真實 probe 一致
- [ ] unconfigured／partial／failed 不會顯示成可用
- [ ] SSRF 拒絕私網與 GitHub 倉庫網址

## Artifacts / Memory

- [ ] 作品有穩定 id／revision，改「第二版」不會另生無關作品
- [ ] conversation／project／workspace memory 分開
- [ ] 重要 memory 有 source／時間／scope／confidence

## DB / Security / Tests / Deploy

- [ ] migration／backup／rollback 已準備
- [ ] 無 secret 進 Git、log、health
- [ ] `npm run lint` `typecheck` `test` `test:ui` `test:chat` `test:workbench` `test:gateway` `test:entry` `test:runtime` `build` `check:secrets`
- [ ] `/api/health` 與 `/api/ready` 不含秘密；`agentReady` 誠實
- [ ] 部署 image／env／卷已記錄，可回滾
