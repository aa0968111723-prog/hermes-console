# 教心所功能完整度盤點

盤點對象：目前 `main` 上的 Hermes Creative Intelligence（正式站 [https://344.zeabur.app](https://344.zeabur.app)）。評等只描述**程式與部署可觀察到的狀態**，不是行銷承諾。

評等：`live`＝此分支已接上真實路徑（仍可能缺上游憑證）；`stub`＝有介面或計畫物件，尚未執行真實來源；`missing`＝教心所研究／行政場景需要但沒有；`regressed`＝曾經在 tip／正式站，後來從 `main` 消失。

## 產品現況（與 JieWorld／SillyWorld 的關係）

| 表面 | 狀態 | 說明 |
| --- | --- | --- |
| `/` Hermes 控制台 | **live** | 聊天、專案、靈感、Agent、龜龜助手。本 PR 在此加上創作／研究／行政模式。沒有用 JieWorld 取代首頁。 |
| `/create` SillyWorld（水光火森） | **regressed on tip／prod；本 PR 恢復** | `c250bdb`／`fcc8895`（9/4）曾在 tip 與 https://344.zeabur.app/create。之後約 21 次合併把檔案沖掉；`main` tip `fdb6613` 與正式站現為 **HTTP 404**。這不是有意下架：沒有「刪除 SillyWorld」的提交。AGENTS.md 不禁止本地粉彩舞台（沒有假大腦）。本 PR 從該祖先 re-port，**不**把 `/` 改回 JieWorld。 |
| 文件標題 vs h1 | 本 PR 對齊 | `/create` metadata／h1 都用「傻的創作小天地」，不再沿用「倢的」。 |
| 窄螢幕「專案」與森林球重疊 | 本 PR 縮小短／窄視窗的球 | 仍屬 UX 細節，請在 390 寬再看一次。 |

研究／行政模式只掛在 `/` 聊天，不改 SillyWorld 的本地問候。

## 路由

| 路徑 | 評等 | 教心所用途 |
| --- | --- | --- |
| `/` | live | 主要工作面：對話 + 模式切換。 |
| `/create` | **regressed on current main／prod（404）**；本 PR 恢復為 live stub（本地舞台，無真實生成） | 創作玩法，不是研究工具。 |
| 其他頁面路由 | missing | 沒有獨立研究案、IRB、參與者或所務後台頁。 |

## 工作區 API

| API | 評等 | 說明 |
| --- | --- | --- |
| `GET/POST /api/workspace` | live | 對話、專案、素材清單；固定 owner `workspace`。 |
| `GET/POST/PUT /api/conversations` | live | 建立／讀取／匯入舊對話。本 PR 可寫入 `assistantMode`。 |
| `GET/POST/PATCH /api/tasks` | live | 真實 Hermes 任務。`POST /api/chat` 只是同一條 POST。本 PR 接受 `mode`。 |
| `GET/POST /api/materials` | live | 圖／文字／PDF 附件，綁專案。 |
| `GET /api/health` | live | Hermes 連線與能力探測；未設定會誠實顯示未設定。 |
| `GET/POST/DELETE /api/auth` | live | No Login：GET 回 `no-login`；登入／登出 410。 |

## 驗證與部署依賴

| 項目 | 評等 | 說明 |
| --- | --- | --- |
| Console 帳號登入 | 刻意沒有 | 開啟網址即用。 |
| `CONSOLE_GATEWAY_SECRET` | live（正式必填） | 瀏覽器拿不到。公開部署沒有閘道會 fail closed（503）。 |
| `CONSOLE_ALLOW_LOCAL_ACCESS` | live | 僅本機 loopback。 |
| `CONSOLE_ORIGIN` | live | 變更請求驗 Origin。 |
| `HERMES_API_URL` / `HERMES_API_KEY` | live（環境） | 未設定則聊天不能送出。 |
| `TKU_MCP_URL` / `TKU_MCP_TOKEN` | stub／未設定 | 淡江 MCP 對應存在，正式站通常 Unconfigured。 |
| Canva / IG / Pinterest / Vault | stub／未設定 | 創作管線用；教心所研究非必要。 |
| 多使用者／研究者帳號 | **missing** | 所有紀錄寫入同一 `workspace`。合作者共用一台部署＝共用資料。 |

## AI／聊天

| 能力 | 評等 | 說明 |
| --- | --- | --- |
| Hermes 對話（創作系統提示） | live | 網宣、靈感、Audience Twin、Canva 草稿。 |
| 研究型模式（教心所） | **live（本 PR）** | 文獻框架、研究問題、方法備註、倫理提醒、結構化筆記。標明不取代 IRB。 |
| 行政型模式（所務／實驗室） | **live（本 PR）** | 會議、行程、信件／表單草稿、歸檔清單。禁止發明制度事實。 |
| 真實文獻檢索／DOI 驗證 | **stub** | `lib/server/research/providers.ts` 只組計畫，`executed: false`。沒有授權工具就不得捏造書目。 |
| 統計分析、轉錄、編碼軟體 | missing | 不做 SPSS／NVivo／自動編碼。 |
| 合成參與者／腦的角色扮演 | 不提供 | 規則禁止假大腦與假裝進度。 |

## 專案與素材

| 能力 | 評等 | 說明 |
| --- | --- | --- |
| 專案資料夾 | live | 對話與素材綁 `projectId`。 |
| 靈感板／試算表匯入 | live／部分 | 創作靈感；不是文獻庫。 |
| 研究案 IRB 狀態、同意書版本 | missing | 只有提示詞提醒。 |
| 參與者／去識別管線 | missing | 後端不會自動去識別上傳內容。 |
| 匯出給共同研究者 | stub | 可複製／下載單次任務 Markdown；沒有研究資料包。 |

## 阻擋研究者的缺口（須先知道）

1. **單一工作區**：沒有研究者帳號或資料隔離。教心所多人使用前，必須靠閘道／VPN 控管誰進這台 Console，並假設彼此看得到同一批對話。
2. **沒有 IRB／同意書工作流**：研究模式只提醒，不存審查編號、不擋「未通過就蒐集資料」。
3. **文獻不是真的查完**：除非 Hermes 端有已授權搜尋工具且實際回傳，否則書目必須當待查。
4. **沒有參與者個資治理**：上傳訪談稿／問卷即進同一 SQLite；沒有保留期限、分級或自動去識別。
5. **閘道與 Hermes 金鑰**：正式站沒有正確 `CONSOLE_GATEWAY_SECRET` 與 Hermes 憑證就無法對話。本機需 `CONSOLE_ALLOW_LOCAL_ACCESS=true`。
6. **`/create` 在 tip／正式站為 REGRESSED（404）**：9/4 曾上線，`main` tip 與 https://344.zeabur.app/create 現為 404。本 PR 恢復本地舞台；它**不是**研究工具，也不能當作已接上生成。

## 有了更好、但不擋試用的項目

- 多租戶或「研究案」空間、匯出／同意紀錄、文獻資料庫連線
- 所辦表單與行事曆的官方來源（目前行政模式刻意不發明）
- 淡江 MCP 真實課表／公告（現為 Unconfigured）
- `/create` 接上真實生成（目前只有 greetingAck）
- JieWorld 首頁若要與 Hermes `/` 並存，需另開產品決策
- 中斷任務的遠端確認、多 replica

## 本 PR 之後夥伴怎麼試

**本機**

1. Node.js 22.13+，`npm ci`，複製 `.env.example` → `.env.local`
2. `CONSOLE_ALLOW_LOCAL_ACCESS=true`，填入已確認的 `HERMES_API_URL`／`HERMES_API_KEY`（不要用曾公開的舊鑰）
3. `npm run dev`，開啟 `/`
4. 在歡迎區切換 **研究** 或 **行政**，用建議句或貼上自己的筆記送出
5. 側欄或歡迎區進 **創作小天地**（`/create`）確認水光火森與本地問候

**正式站**

- 產品網址：https://344.zeabur.app（須由已授權閘道進入）
- **現況：** `/` = 200，`/create` = **404（REGRESSED）**
- 部署本 PR 後：同一條聊天可切模式；`/create` 應再回 200

契約測試（`npm test`）只證明模式提示與 API 契約，**不是** Zeabur 或教心所實機審查證據。
