# Hermes Console 正式產品化盤點

基準：`cursor/hermes-production-finalization-cf7e`（接續 `origin/main`）。這不是新 App，也不是第二套 Dashboard。狀態以程式與測試為準，不以文件宣稱為準。

## 總覽

| 區域 | 判斷 | 說明 |
| --- | --- | --- |
| AuthGate / User / Identity | 部分可用 | Google OIDC + Email Argon2id + 淡江 SSO 抽象已接入。未設 IdP metadata 時顯示「尚未完成設定」。本機 `CONSOLE_ALLOW_LOCAL_ACCESS` 可略過閘，禁止用於公開部署 |
| 手機捲動 | 部分可用 | App shell 鎖定；主捲動在 `.conversation-scroll`／`.secondary-page`；dock `fixed`。契約測試有 nested scrollport，非正式真機 |
| Runtime Inspector | 部分可用 | 一般檢視只顯示 Hermes／記憶／工具／MCP。開發者檢視才露出 schema 與工具清單 |
| MCP Registry | 部分可用 | GET 不回 endpoint／憑證名／schema。未探測的已設定 MCP 是 `awaiting_authorization`，不是 partial。tools/list 成功才是 partial；缺 token 是 unconfigured |
| Artifacts / 版本 | 部分可用 | `artifactId`／`revisionId`、還原（新版本複製舊設計）、fork。Canva poll 成功會寫入 |
| Memory 分層 | 部分可用 | `listMemories` 依 scope 精確過濾；`memoriesForProject` 才把工作區偏好併入專案脈絡並保留 scope 標籤 |
| 設定頁 | 部分可用 | 帳號／外觀／連線／工作區／進階 |
| CI | 部分可用 | lint／typecheck／unit／Playwright／build／secrets |
| 部署 | Partial | 文件齊；本輪不執行公開 Zeabur 佈署 |

## 完全可用（契約層）

- Origin 驗證、rate limit、確認 token、工具權限分級
- SQLite／Postgres 雙後端
- `/api/ready`、`GET /api/health` 不回秘密
- SSRF 守衛
- 龜龜狀態（含 offline／planning／creating）

## 部分可用

- 正式 Auth：Google／Email 需部署端密鑰；淡江 SSO 缺校方 metadata
- MCP 真實探測需各服務 URL／TOKEN
- Artifact 比較 UI 是版本選單，不是並排 diff
- 多裝置 session 清單未做（只結束目前瀏覽器）
- Inspiration／Audience Twin／研究 Markdown 檢索

## 危險／誠實限制

- 公開部署若無閘道或 Auth 密鑰，行為必須 fail closed
- Tamkang MCP 權杖 ≠ 淡江 SSO
- 曾暴露金鑰一律視為 compromised
- 本輪沒有 live Zeabur／校方 IdP／Google 實機登入證據

## 本次已修

1. 手機捲動所有權（前一輪）
2. 統一 AuthGate（前一輪）
3. MCP 誠實狀態 + 公開 registry 消毒
4. Artifact 版本／還原／fork
5. Memory scope 隔離
6. Runtime／任務 JSON 收到開發者檢視
7. 設定頁收斂
8. Android 鍵盤：`--app-height` 只在鍵盤開啟時跟隨 visualViewport，關閉後回到 `100dvh`
9. 連線格：Hermes／Workspace／Atlas／Zeabur 不再把「已填密鑰」顯示成已連線
10. 首頁快捷：手機與桌面同一組六個短標籤（研究／創作／分析／客群／靈感／設計）
