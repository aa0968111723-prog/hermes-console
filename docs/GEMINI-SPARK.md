# 把 Hermes Console 接進 Gemini Spark

靈感庫是 Console 自己的功能，不是 Gemini 內建名稱。
Gemini Spark「自訂應用程式」要的是 MCP server URL，不是 GitHub 倉庫或網站首頁。

## 今天先用 Skill（不要等部署）

1. 電腦開 [gemini.google.com](https://gemini.google.com) → Spark → Skills。
2. 上傳 `skills/hermes-inspiration-board/SKILL.md`（或把同目錄打成 zip，根目錄必須有 SKILL.md）。
3. 建立 Spark 任務時輸入 `/`，選 `hermes-inspiration-board`。
4. 把要收藏的 HTTPS 網址貼進對話，請 Spark 依照靈感板格式整理。
5. 要寫回 Console 時，到 [https://344.zeabur.app/](https://344.zeabur.app/) 開「靈感」，依對話結果手動貼網址收藏。

Skill 讓 Spark 使用相同的靈感語言與規則。它**不會** 自動寫進 Console SQLite。

## 自訂應用程式該貼的網址

只貼這個（電腦網頁新增，不要在手機完成授權）：

```text
https://344.zeabur.app/api/mcp
```

不要貼：

- `https://github.com/aa0968111723-prog/hermes-console`
- `https://344.zeabur.app/`

步驟：

1. 電腦開 [gemini.google.com](https://gemini.google.com)
2. 設定與說明 → 已連結的應用程式（有時在「個人智慧」下面）
3. Spark 適用的自訂應用程式 → 貼上面 URL → 繼續
4. 完成授權
5. Spark 任務輸入 `@`，選這個應用程式

官方仍寫 custom apps 限美國、英文、個人帳戶、保留活動紀錄。台灣帳號看得到欄位不等於一定連得上。

## 為什麼現在貼 `/api/mcp` 仍會失敗

部署未合併本分支前：

- MCP 只接 `Authorization: Bearer <MCP_BRIDGE_TOKEN>`
- 沒有 `/.well-known/oauth-protected-resource`
- Spark 預設走 OAuth 2.1 + Dynamic Client Registration
- Origin 必須等於 `CONSOLE_ORIGIN`
- health 若是 `unconfigured`，表示 `HERMES_API_URL` / `HERMES_API_KEY` 還沒設

本分支會加上 `inspiration_list`、`inspiration_ingest`、`inspiration_search`，並讓 Spark 可走 OAuth。合併並重新部署後才能讓「繼續」完成授權。

## Zeabur 必須先配的變數

在 Zeabur 專案 → Variables 填：

```text
CONSOLE_ORIGIN=https://344.zeabur.app
HERMES_API_URL=你的 Hermes HTTPS API 網域
HERMES_API_KEY=新的、從未公開的金鑰
MCP_BRIDGE_TOKEN=至少 32 個隨機字元，只存 Zeabur 與 Hermes
CONSOLE_VAULT_KEY=64 個十六進位字元
```

遺漏可選：

```text
MCP_ALLOWED_ORIGINS=
```

配完後打開：

`https://344.zeabur.app/api/health`

不應再是 `unconfigured`。

`MCP_BRIDGE_TOKEN` 不是 Spark 進階欄位的 OAuth client secret，不要貼進 Gemini。

## 連上之後 Spark 怎麼用

```text
@Hermes Console 請把 https://example.com/post 匯入個人專案靈感庫。
@Hermes Console 列出目前已收藏的靈感。
@Hermes Console 尋找與「淡江活動」相關的靈感。
```

對應工具：

- `inspiration_ingest`
- `inspiration_list`
- `inspiration_search`

不要讓 Spark 經 MCP 自動做 Canva 導出或社群發布。

## 安全

這站免登入。把 `/api/mcp` 交給 Spark，等於讓 Google 代理使用工作區工具。建議先加 Cloudflare Access、IP allowlist 或 Zeabur 私有網路，再開放給 Spark。
