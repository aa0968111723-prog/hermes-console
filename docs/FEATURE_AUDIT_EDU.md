# 教心所功能完整度盤點

盤點對象：目前 `main` 上的 Hermes Creative Intelligence（正式站 [https://344.zeabur.app](https://344.zeabur.app)）。評等只描述**程式與部署可觀察到的狀態**，不是行銷承諾。

評等：`live`＝此分支已接上真實路徑（仍可能缺上游憑證）；`stub`＝有介面或計畫物件，尚未執行真實來源；`missing`＝教心所研究／行政場景需要但沒有；`regressed`＝曾經在 tip／正式站，後來從 `main` 消失。

本 PR **不改使用者看到的 Console UI**。研究／行政能力在後端，呼叫端傳 `assistantMode`／`mode` 才會套用；瀏覽器預設仍是現有創作控制台。

## 產品現況（與 JieWorld／SillyWorld 的關係）

| 表面 | 狀態 | 說明 |
| --- | --- | --- |
| `/` Hermes 控制台 | **live** | 現有聊天、專案、靈感、Agent、龜龜助手。畫面與 `main` 相同，沒有模式開關。 |
| `/create` SillyWorld（水光火森） | **REGRESSED on tip／prod** | `c250bdb`／`fcc8895`（9/4）曾在 tip 與 https://344.zeabur.app/create。之後合併把檔案沖掉；`main` tip `fdb6613` 與正式站現為 **HTTP 404**。沒有「刪除 SillyWorld」的提交。依產品回饋「不要用 UI，現在的就好」，**本 PR 不恢復該舞台**。 |
| 文件標題「倢的」vs h1「傻的」 | 屬已流失的 `/create` 待辦 | 不在本 PR 範圍。 |
| 窄螢幕「專案」與森林球重疊 | 屬已流失的 `/create` 待辦 | 不在本 PR 範圍。 |

## 路由

| 路徑 | 評等 | 教心所用途 |
| --- | --- | --- |
| `/` | live | 現有創作控制台。研究／行政不由此切換。 |
| `/create` | **REGRESSED（tip／prod 404）** | 本 PR 不恢復。 |
| 其他頁面路由 | missing | 沒有獨立研究案、IRB、參與者或所務後台頁。 |

## 工作區 API

| API | 評等 | 說明 |
| --- | --- | --- |
| `GET/POST /api/workspace` | live | 對話、專案、素材清單；固定 owner `workspace`。 |
| `GET/POST/PUT /api/conversations` | live | 建立／讀取／匯入舊對話。可選 `assistantMode`: `creative` \| `research` \| `admin`。省略則 `creative`。 |
| `GET/POST/PATCH /api/tasks` | live | 真實 Hermes 任務。`POST /api/chat` 同一條。可選 `mode`；省略則用對話已存模式，再否則創作提示。 |
| `GET/POST /api/materials` | live | 圖／文字／PDF 附件，綁專案。 |
| `GET /api/health` | live | Hermes 連線與能力探測；未設定會誠實顯示未設定。 |
| `GET/POST/DELETE /api/auth` | live | No Login：GET 回 `no-login`；登入／登出 410。 |

## 驗證與部署依賴

| 項目 | 評等 | 說明 |
| --- | --- | --- |
| Console 帳號登入 | 刻意沒有 | 開啟網址即可用現有 UI。 |
| `CONSOLE_GATEWAY_SECRET` | live（正式必填） | 瀏覽器拿不到。公開部署沒有閘道會 fail closed（503）。 |
| `CONSOLE_ALLOW_LOCAL_ACCESS` | live | 僅本機 loopback。 |
| `CONSOLE_ORIGIN` | live | 變更請求驗 Origin。 |
| `HERMES_API_URL` / `HERMES_API_KEY` | live（環境） | 未設定則聊天不能送出。 |
| `TKU_MCP_URL` / `TKU_MCP_TOKEN` | stub／未設定 | 淡江 MCP 對應存在，正式站通常 Unconfigured。 |
| Canva / IG / Pinterest / Vault | stub／未設定 | 創作管線用；教心所研究非必要。 |
| 多使用者／研究者帳號 | **missing** | 所有紀錄寫入同一 `workspace`。 |

## AI／聊天

| 能力 | 評等 | 說明 |
| --- | --- | --- |
| Hermes 對話（創作系統提示） | live | 現有 UI 走這條。網宣、靈感、Audience Twin、Canva 草稿。 |
| 研究型模式（教心所） | **live（API，無新 UI）** | `POST /api/conversations` 帶 `assistantMode: "research"`，或 `POST /api/tasks` 帶 `mode: "research"`。文獻框架、研究問題、方法備註、倫理提醒。不取代 IRB。 |
| 行政型模式（所務／實驗室） | **live（API，無新 UI）** | 同上，值為 `admin`。會議、行程、信件／表單草稿、歸檔清單。禁止發明制度事實。 |
| 真實文獻檢索／DOI 驗證 | **stub** | `lib/server/research/providers.ts` 只組計畫，`executed: false`。 |
| 統計分析、轉錄、編碼軟體 | missing | 不做 SPSS／NVivo／自動編碼。 |
| 合成參與者／腦的角色扮演 | 不提供 | 規則禁止假大腦與假裝進度。 |

## 專案與素材

| 能力 | 評等 | 說明 |
| --- | --- | --- |
| 專案資料夾 | live | 對話與素材綁 `projectId`。 |
| 靈感板／試算表匯入 | live／部分 | 創作靈感；不是文獻庫。 |
| 研究案 IRB 狀態、同意書版本 | missing | 只有提示詞提醒。 |
| 參與者／去識別管線 | missing | 後端不會自動去識別上傳內容。 |
| 匯出給共同研究者 | stub | 可複製／下載單次任務 Markdown。 |

## 阻擋研究者的缺口（須先知道）

1. **單一工作區**：沒有研究者帳號或資料隔離。
2. **沒有 IRB／同意書工作流**：研究模式只提醒。
3. **文獻不是真的查完**：未授權工具就不得當已查完。
4. **沒有參與者個資治理**：上傳即進同一 SQLite。
5. **閘道與 Hermes 金鑰**：正式站沒有正確設定就無法對話。
6. **`/create` 在 tip／正式站為 REGRESSED（404）**：依回饋不在本 PR 恢復。
7. **現有 UI 不會切研究／行政**：夥伴若要試這兩種模式，需由已授權客戶端傳 `mode` 欄位（或之後另做產品決策再加開關）。

## 有了更好、但不擋契約的項目

- 多租戶或「研究案」空間、匯出／同意紀錄、文獻資料庫連線
- 所辦表單與行事曆的官方來源
- 淡江 MCP 真實課表／公告
- 是否恢復 `/create` 或加 UI 開關：產品決策，本 PR 不做
- 中斷任務的遠端確認、多 replica

## 本 PR 之後夥伴怎麼試

**畫面（與今天相同）**

1. Node 22.13+，`npm ci`，`.env.local`：`CONSOLE_ALLOW_LOCAL_ACCESS=true` 與已確認 Hermes 金鑰
2. `npm run dev`，開 `/` — 仍是「今天想做什麼？」創作控制台
3. 正式站 https://344.zeabur.app ：`/` = 200；`/create` 仍為 **404（REGRESSED）**

**研究／行政（無新 UI）**

已授權來源、帶 `Origin` 的請求：

```http
POST /api/conversations
{ "title": "教心所筆記", "assistantMode": "research" }

POST /api/tasks
{ "conversationId": "…", "requestKey": "…", "input": "幫我收斂研究問題", "mode": "research" }
```

`admin` 同理。省略欄位則維持創作提示。契約測試證明欄位與提示詞，**不是** Zeabur 或 IRB 實機證據。
