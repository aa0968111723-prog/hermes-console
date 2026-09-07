## 摘要

將 Hermes Console 升級為 **Hermes Creative Intelligence**：免登入單一工作區。開啟網址即可對話，不再出現登入頁、註冊、帳號或密碼。秘密仍只存在 server-side env / encrypted vault。

## No-login architecture

- Browser → Console Server → server-held credentials → Hermes / MCP / Canva。
- 所有資料使用固定 namespace `workspace`，不在 UI 顯示。
- `CONSOLE_USERNAME` / `CONSOLE_PASSWORD_HASH` 不是啟動必要條件。
- Canva OAuth 仍是連外部 Canva 帳號，與 Console 免登入無關。

## 安全模型

- 保留 Origin 檢查、rate limit、request/upload size、timeout、SSRF／URL 驗證、API allowlist、secret redaction。
- 工具分 read / draft / write / publish / destructive。
- 高風險副作用需要伺服器核發、一次性、短效、綁定 action+target+payload hash 的確認 token。`confirmed=true` 不足。
- Instagram 發佈預設關閉，即使免登入也必須人工確認。
- 公開 Internet 部署可消耗 Hermes／MCP；請用 Zeabur private networking、reverse proxy、Cloudflare Access、VPN 或 IP allowlist。不要在 UI 恢復登入。
- 曾公開的 Hermes API Key 必須撤銷並重新產生。

## Hermes Multi-Agent

- Agent Registry：general / creative / research / tku / design / social / development / reviewer。
- 憑證以 env 參照保存，不寫入 SQLite 明文。
- 能力從實例探索（unknown / unsupported / available / partial / failed）。
- 上游呼叫送出 `X-Hermes-Session-Key`（workspace / project:<id> / campaign:<id>）。
- Agent Brain 僅在實例支援 memory／session_search 時顯示。
- 使用量記錄 tokens／工具／時長，不估算未提供的價格。
- 多代理交接深度最多 2，含 timeout／budget／Stop。

## Memory / MCP / Tamkang / IG / Pinterest / Audience Twin / Canva

- MCP Registry：initialize ≠ verified；tools/list = partial；安全讀取 = verified。GitHub URL 不是 MCP。
- 淡江：`TKU_MCP_URL` / `TKU_MCP_TOKEN` + capability mapping；離線改網頁研究。
- Instagram 研究 vs 發佈；不宣稱搜尋完整 Instagram。
- Pinterest Pin／看板 URL + 網頁；不假裝官方全站搜尋。
- 「幫我找靈感」產生 Inspiration Board。
- Audience Twin 分開 Evidence / Hypothesis，分數 0–100，永遠附「AI 模擬評估，不代表真實市場調查。」
- Canva 保留既有 PKCE／vault；新增 template／dataset mapping／Open in Canva。未授權時流程標記 Needs Canva Authorization。

## Tool Permissions / 測試 / 部署 / 尚未授權服務

- Web／IG／Pinterest／PDF／MCP／素材皆為不可信資料；「忽略系統指令」不執行。
- `npm test`、`typecheck`、`build`、`test:ui`、`test:chat`、`audit`、`check:secrets` 已在本分支執行。
- 部署：長駐 Node.js、SQLite、Persistent Volume、single replica、HTTPS。
- 尚未授權：真實 Zeabur Hermes、Canva 使用者 OAuth、Tamkang MCP、Instagram／Pinterest API。介面顯示 Unconfigured / Needs Authorization，不假裝 Connected。

完整狀態見 docs/DELIVERY.md 與 docs/DEPLOYMENT.md。
