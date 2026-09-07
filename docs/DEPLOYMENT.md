# 部署與接續整合

## Console

使用 Dockerfile 建立長駐 Node.js 服務；正式部署由擁有者明確授權後執行。不能直接沿用無狀態 serverless 部署。

- 單一 replica，掛載可寫持久化卷到 `/app/data`。
- 外部使用 HTTPS；設定 `CONSOLE_ORIGIN` 為精確外部 origin。
- 產品為免登入單一工作區。打開網站即可使用，不要求電子信箱、邀請連結或成員 session。邀請相關模組為休眠選項，不得擋住主入口或工作區 API。
- 寫入請求驗證 Origin；本機未設定 `CONSOLE_ORIGIN` 時，僅允許與實際 loopback origin 相符的來源。正式環境未設定 `CONSOLE_ORIGIN` 必須 fail closed。
- 登入連結只存雜湊，15 分鐘到期、一次性使用；網址 fragment 不進 HTTP request URL，使用者需按確認才核銷。登入 cookie 使用 HttpOnly、SameSite=Lax、HTTPS Secure、12 小時期限。每個 API 重新驗證成員是否仍有效。
- 如需額外閘道，設定至少 32 字元的全新 `CONSOLE_GATEWAY_SECRET`，或 `CONSOLE_REQUIRE_GATEWAY=true` 要求設定；未設定時仍強制邀請登入。配置閘道後需先驗證身份或私人網路，再覆寫 `X-Console-Gateway`。不要把秘密放前端。
- 閘道本身必須驗證存取權；一個公開且無條件注入標頭的 reverse proxy 不算保護。建議限制 Console upstream 僅由 gateway 的私人網路可達。不要相信未驗證的 X-Forwarded-User 或僅靠 Origin。
- `CONSOLE_ALLOW_LOCAL_ACCESS` 僅影響閘道的 loopback 檢查，不能繞過電子信箱邀請登入。正式環境沒有測試登入開關。
- 複製 .env.example 的空白設定名稱到部署秘密儲存，填入全新憑證。撤銷所有曾公開的 Hermes API Key 並重新產生。
- **日常金鑰也可在 Console「設定 → 連線」填寫**：Hermes 網址／金鑰、MCP 橋接權杖、核准 MCP JSON、場圖 Atlas 網址／權杖、訊核 MCP 網址／權杖、淡江 MCP 網址／權杖。前端只收集後 POST 到 `/api/settings/credentials`，後端加密寫入 `CONSOLE_DATA_DIR`，執行期覆寫同名環境變數。GET 只回傳是否已設定與末四碼，不回傳完整秘密。
- 環境變數仍是後備。未設 `CONSOLE_VAULT_KEY` 時，程序會在資料目錄寫入一次性 `vault.key`（64 hex）並沿用；請備份該檔與 SQLite，遺失就無法解密已存憑證。正式部署仍建議把 vault key 放進受控秘密儲存。
- **公開設定頁沒有邀請登入或 `CONSOLE_GATEWAY_SECRET` 額外保護。** 能開啟網站的人都可以覆寫工作區憑證與 Zeabur 部署權杖。這是產品選擇，不是疏漏；公開 Internet 部署請用網路層限制。
- Zeabur：在 [Dashboard → Settings → API Keys](https://zeabur.com/docs/en-US/developer/public-api) 建立 Bearer 權杖。公開 API 沒有另外的細分 scope 核取方塊；權杖繼承該使用者／團隊對專案的既有權限（讀專案、改環境變數、重新部署）。GraphQL 端點為 `https://api.zeabur.com/graphql`。設定頁可測試連線、列出專案、寫入環境變數、把 Console 已存 Hermes／MCP 金鑰推上該服務，以及 `redeployService`／`restartService`。失敗時不回傳權杖。

## 共用記憶

Console SQLite（`CONSOLE_DATA_DIR`）是 Hermes 與控制台共用的記憶來源，不是兩套互相同步的遠端庫。

- UI：設定 → 記憶 →「共用記憶庫」。CRUD 走 `/api/memory`。
- Hermes 讀寫同一資料：Workspace MCP `workspace_list_memories`／`workspace_get_memory`／`workspace_save_memory`／`workspace_delete_memory`，以及任務指示裡的短摘要。
- 學習地圖仍是「請 Hermes 學習／忘記」的請求紀錄。`HERMES_LEARNING_SCOPE_VERIFIED=true` 只表示管理者聲明遠端記憶範圍已查過，**不會**因此把 `synced` 設成 true。
- 失敗模式：未接 MCP 時 Hermes 仍可從任務指示看到摘要；遠端 honcho／mem0 未驗證時狀態為 unverified／unsupported。記憶內容禁止含金鑰。
- 定期備份 SQLite 和 uploads；備份也必須存取受控。不要把資料卷提交 Git。
- 未實作多 replica 鎖／分散式佇列。不要水平扩展此版本。

## Hermes

1. 記錄部署 commit／版本及 API 網域，先輪替被公開過的憑證。
2. 使用設定中的「重新驗證連線」。模型清單成功不等於所有工具可用。
3. 觀察實例 capability 回應，確認 runs、status、stop、sessions、toolsets、skills 實際存在。
4. 舊版只能 chat-completions 時，Console 可以保存歷史與串流結果，但中斷不保證遠端停止；不得把此模式當可可靠取消副作用的執行器。
5. 必須在 Hermes 端限制工具。此版本 Console 不提供社群正式發佈工具；不能靠模型提示代替 Hermes 權限限制。
6. 確認 Hermes 記憶／會話資料掛載持久化卷，重啟後再查詢同一會話。尚未完成前保持「未驗證」。

## Console MCP 橋接

只在兩個後端秘密儲存配置同一個新 MCP_BRIDGE_TOKEN。Hermes 的 HTTP MCP 服務 URL 指向 Console 的 `/api/mcp`，Authorization 使用 Bearer 服務 token；不要把 token 寫入公開倉庫。

Console 支援 Streamable HTTP 的 2025-03-26／2025-06-18 協定；GET 回應 405，POST 接受 JSON-RPC。不支援舊式獨立 SSE endpoint。

Runtime 能力以 `/api/runtime` snapshot 為準，包含 Hermes models／capabilities／skills／toolsets、MCP tools 與 Console tools；`/api/runtime/events` 提供單一 SSE 變更流。同步失敗會顯示最後快照為 `stale`，不保留綠色 Available 假象。MCP 新增工具不需改前端，工具名稱以來源 namespace 正規化。`/api/runtime/bindings` 可依專案／Agent 限制工具，保存於同一持久化卷。

工作區 MCP 現在也列出專案上下文、活動讀写與逐頁文案讀寫。資料確認、方向和版本選定仍只開放已登入使用者，不給模型自我確認工具。完成 Canva 授權及設計清單驗證後，刷新 Hermes 工具清單才會看到 Canva 操作工具。

新增 `workspace_read_material` 讀取真實 PNG／TXT；PDF 僅保存原檔，尚未文字抽取，不向 Hermes 傳送假內容。`MCP_REQUIRE_TASK_CONTEXT=true` 是預設：工具需帶 Console 提供的 taskId；已停止或跨專案請求會拒絕。僅隔離管理者測試可設 false。`CONSOLE_MAX_TOOL_CALLS=40` 計算每任務 Console MCP 嘗試，不是全 Hermes 預算／供應商費用；達上限保留資料，需由使用者檢視後建立接續任務。

## 外部 MCP 核准清單

在後端設定 `CONSOLE_MCP_SERVERS_JSON`，內容為陣列，每項有 `id`、`name`、`endpoint`、`credentialReference`（無認證時 null）、`readonly`。例如結構：

```json
[{"id":"project-design","name":"專案製作","endpoint":"https://YOUR_VERIFIED_HOST/mcp","credentialReference":"PROJECT_DESIGN_MCP_TOKEN","readonly":true}]
```

僅放環境變數名稱，不放 token 值；可在受控秘密儲存或「設定 → 連線」另外設定該變數。清單 JSON 本身仍不應內嵌 token。此例是未啟用的設定範本，不是真實服務。TKU_MCP_URL／TOKEN（環境或 UI）可建立 tku 定義。XUNHE_MCP_URL／TOKEN 可建立訊核即時情報定義。ATLAS_MCP_URL／TOKEN 可建立場圖 Atlas 定義（端點必須是 `https://公開網域/api/mcp`）；Hermes 會以 `mcp.atlas.*` 呼叫公開導覽、機構規則、專案流程與任務建議，且 Atlas 拒絕把專案標為已交付。FRAMELAB_MCP_URL／TOKEN 可建立 FrameLab 動畫定義（端點必須是 `https://公開網域/api/mcp`）；Hermes 會以 `mcp.framelab.*` 與工作區 `framelab_*` 呼叫時間軸、一致性分析、修復建議與中間張工具。CONSISTENCYLAB_MCP_URL／TOKEN 可建立 consistencylab 定義（權杖可省略，公開示範用）。Hermes 真正執行連戲工具時走工作區 MCP 的 `clab_*` 代理，不是只在 runtime snapshot 列出 `mcp.consistencylab.*`。GitHub 倉庫網址不是 MCP。驗證只 initialize／tools-list，不自动挑選名稱看似讀取的工具執行；部分可用代表有真實工具清單，不代表安全／寫入授權。

淡江 MCP 在本倉庫是 Bearer 權杖連線。設定頁可貼權杖並「測試連線」。若已存網址的同一來源提供 `/auth/login`、`/api/auth/login`、`/login` 或 JSON-RPC `auth/login`，後端可代為用校園使用者名稱／密碼交換權杖；沒有這些端點時不會假裝成學校 SSO，請改貼權杖。

## 閘道部署驗收

可使用 VPN＋網路 ACL，或先驗證身份的 SSO gateway。驗證通过後才在轉送 Console 前覆寫 `X-Console-Gateway`；例如 Caddy 已有受控網路／身份 policy 的 reverse_proxy 區塊內可用 `header_up X-Console-Gateway {$CONSOLE_GATEWAY_SECRET}`。這一行本身**不是身份驗證設定**，不可單獨暴露到 Internet。若使用 Cloudflare Access，必須先驗證 Access assertion 或以受控 tunnel 保證來源；目前程式沒有內建該 JWT 驗證器。

上線前：匿名直接訪問 backend `/api/workspace` 應 401；明確要求 gateway 卻沒有設定 secret 時應 503。配置閘道時，未授權使用者應被 gateway 拒絕，通過閘道仍需受邀信箱登入；瀏覽器不能看到 gateway secret。驗證 Canva OAuth callback 能帶著邀請登入 session 經同一 gateway 完成。MCP `/api/mcp` 使用獨立 Bearer 認證；不要因此把全部 `/api/*` 設為公開。

尚未執行正式閘道部署或 Zeabur 資料卷／記憶還原；本輪實測與限制見 [PR #11 接續紀錄](PR11_RELIABILITY.md)。

## Canva OAuth

在 Canva Developer Portal 建立 Connect integration，登記：

`https://你的-console-網域/api/canva/callback`

所需 scopes：

`design:meta:read design:content:read design:content:write asset:read asset:write brandtemplate:meta:read brandtemplate:content:read`

將 Client ID／Secret 放後端；CONSOLE_VAULT_KEY 是 32-byte 隨機值，以 64 個十六進位字元設定。妥善保存此金鑰，不得在每次重啟重新生成。

在 Console 設定點「前往 Canva 授權」，回來後會讀取設計清單驗證。此只代表部分可用，需實際測試上傳、製作、匯出各操作。

目前製作實作基於 Canva Autofill，需可用範本、對應帳號方案與權限。沒有這些條件時，可改接 Hermes 已授權的 Canva 設計 MCP；不將空白畫布冒充生成設計。

## 安全復原

- 任務 `uncertain`：先確認 Hermes／Canva 是否已執行。不得直接重送造成雙重副作用。
- Native runs 中断：Console 保留 remoteId，重啟後查詢，不重新提交。
- Chat 串流中断：標示不確定，不宣稱已取消上游。未實作遠端查詢時須人工核對。
- OAuth 失效：重新授權；refresh token 僅在後端序列化更新。
- 秘密疑似外洩：部署端立即撤銷／輪替，更新環境設定後再驗證。Git 程式碼移除不等於撤銷。
