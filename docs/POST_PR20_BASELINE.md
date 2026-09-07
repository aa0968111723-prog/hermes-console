# Post-PR20 Baseline

基準：`main` `6d168ef`（Merge pull request #20）。盤點日期：2026-09-07。盤點方式：讀 UI → API → server → persistence → external service。**沒有對真實 Hermes / Zeabur / Tamkang / Canva 做 live probe。**

本文件不是完成宣告。分類只描述目前 `feat/post-pr20-agent-os` 從 current main 看到的狀態。

## Source of truth

- CURRENT MAIN 是唯一 implementation source of truth。
- PR #19：連線憑證、淡江測試／權杖交換、免登入設定頁。
- PR #20：共用 SQLite 記憶 + Zeabur GraphQL（含寫入／重啟／重新部署）。
- PR #21：長任務契約（`docs/POST_PR20_LONG_TASK.md`），不含實作。
- PR #10：只當能力需求來源，不 merge、不大量 cherry-pick。

## Product invariants（不得改掉）

- 免登入單一工作區。`/` 直接進入 `HermesConsole`。
- 明亮、聊天優先、手機優先。導覽：對話／專案／靈感／Agent／設定。
- 龜龜由真實 task／tool event 驅動，禁止 timeout 假裝研究。
- Hermes 是唯一執行器。不得偽造來源、記憶同步、Canva／Zeabur 成功。
- 不顯示 chain-of-thought。

## Classification legend

| Label | Meaning |
| --- | --- |
| LIVE | 真實程式路徑存在，設定憑證後會打到外部服務 |
| LOCAL_VERIFIED | 本機契約／瀏覽器測試通過；不是 live 證據 |
| LIVE_UNVERIFIED | 能打 live，本輪沒有真實憑證證據 |
| PARTIAL | 有一部分真的，承諾的其餘部分沒有 |
| STUB | 計畫物件、規則、目錄，尚未執行 |
| DORMANT | 程式在，產品入口不用 |
| REGRESSED | 仍在樹裡，目前導覽到不了 |
| DEAD_CODE | UI 或執行路徑沒有引用 |

Verification evidence（P0-D，之後所有驗證只能用這些）：

| Evidence | Meaning |
| --- | --- |
| LOCAL_UNIT | 純函式／單元 |
| LOCAL_CONTRACT | mock HTTP／隔離 SQLite 契約 |
| LOCAL_BROWSER | Playwright／本機 Console |
| LIVE_EXTERNAL | 真實外部 HTTPS 服務 |
| UNVERIFIED | 尚未檢查 |

Mock Hermes = `LOCAL_CONTRACT`，不得寫 Hermes Verified。  
Playwright = `LOCAL_BROWSER`，不得寫 Zeabur Live Verified。

## Honesty gaps that matter

1. `GET /v1/models` 成功會把 Hermes 憑證標 `valid`，並把 `health.agent` 在**任何一次成功任務後**標 `verified`。這不是逐項 capability certification。
2. 設定頁 IntegrationHealth 把 `available` 顯示成 **Connected**。Connected ≠ 可用。
3. `researchBundle.executed` **永遠 false**；`sources`／`claims` 空。官方 URL 是待查目錄（`not_fetched`）。
4. Audience Twin 是規則模擬，`simulation: true`。UI 的 `AudienceCard` **沒掛上**。
5. Agent 面板寫死八個角色；聊天永遠走 `general`。
6. 沒有 Context Engine／Goal Interpreter／Planner／Tool Router／Fallback Graph。Shared Memory 是最多 8 筆塞進 system prompt。
7. Zeabur `update_env`／`push_console_keys`／`redeploy`／`restart` **沒有** confirmation token。公開站任何人可改部署。
8. 手機沒有 Task Status Pill；≤380px 連 compact 龜龜都藏起來。
9. 任務對話裡有事件紀錄，但沒有使用者可讀的 Plan timeline。
10. 若干文件（`DEPLOYMENT.md` 部分、`PR11_RELIABILITY.md`、`LEARNING_INVITATIONS.md`）仍寫邀請登入或強制閘道；**已被 no-login 取代**。

---

## Feature matrix

追線：UI → API → server → persist → external。Evidence 是目前倉庫裡**已經有的**驗證，不是本輪 live。

### Workspace / Chat / Tasks

| Feature | Class | UI | API | Server | Persist | External | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 免登入 `/` | LIVE | `app/page.tsx` → `HermesConsole` | workspace APIs | `authenticate()` → owner `workspace` | SQLite | none | LOCAL_CONTRACT, LOCAL_BROWSER |
| 對話 CRUD／分支 | LIVE | HermesConsole | `/api/conversations` `/api/workspace` | `tasks.ts` store | SQLite `conversation` | none | LOCAL_CONTRACT, LOCAL_BROWSER |
| 送出聊天 | LIVE / LIVE_UNVERIFIED | POST `/api/tasks` | 同 `/api/chat` | `submit` → `execute` | SQLite `task` | Hermes chat 或 runs | LOCAL_CONTRACT（隔離 Hermes）；LIVE_EXTERNAL = UNVERIFIED |
| 串流顯示 | PARTIAL | 3s poll `task.output`，UI 不接 Hermes SSE | GET `/api/tasks` | chat SSE 在後端消化 | SQLite | Hermes stream | LOCAL_CONTRACT |
| Native runs | LIVE / LIVE_UNVERIFIED | 同任務 UI | 同上 | `POST /v1/runs` + poll/events | SQLite + `remoteId` | Hermes runs | LOCAL_CONTRACT；LIVE = UNVERIFIED |
| Stop | PARTIAL | 任務對話「要求停止」 | PATCH `{action:stop}` | runs 才有可驗證 stop；chat 中斷後 `uncertain` | SQLite | Hermes `/stop` | LOCAL_CONTRACT |
| 重新整理恢復 | PARTIAL | localStorage 只記 active conversation id | GET tasks 會 `reconcile` | chat worker 在 process memory；restart 後 chat → `uncertain`；runs+remoteId 可查回 | SQLite + in-memory Map | Hermes run status | LOCAL_CONTRACT；未知狀態禁止自動重送（已做） |
| 草稿 | STUB | 分頁記憶體 | none | none | none | none | LOCAL_BROWSER（註解寫明會清掉） |
| 不造假回答 | LIVE | 離線／失敗顯示錯誤 | 503/504 | 「沒有產生備援回答」 | — | — | LOCAL_CONTRACT |

### Hermes discovery / health

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| 模型清單 | LIVE / LIVE_UNVERIFIED | Settings 重新驗證 → POST `/api/health` → `/v1/models` | LOCAL_CONTRACT |
| capabilities / skills / toolsets | LIVE / LIVE_UNVERIFIED | 同上，失敗不假裝工具可用 | LOCAL_CONTRACT |
| Agent 已驗證 | PARTIAL | 一次 completed task 就把 `health.agent=verified` | 過度概括；P0 要拆 |
| Runtime snapshot / SSE | LIVE / LIVE_UNVERIFIED | Agent 頁 `RuntimeInspector` `/api/runtime` `/api/runtime/events` | LOCAL_CONTRACT |
| Image input | STUB / unsupported | `HERMES_IMAGE_INPUT=false` 預設 | UNVERIFIED |
| 遠端 Hermes memory API | unsupported | `upstream()` allowlist **沒有** memory CRUD | 不得標 verified |

### Shared Memory

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| CRUD UI | LIVE / LOCAL_VERIFIED | 設定 → 記憶 → `/api/memory` → `lib/server/memory.ts` → SQLite `shared_memory` | LOCAL_CONTRACT, LOCAL_BROWSER（PR20） |
| Workspace MCP 同庫 | LIVE / LOCAL_VERIFIED | `workspace_list/get/save/delete_memory` | LOCAL_CONTRACT |
| 任務指示摘要 | LIVE | `memoryDigest` 最多 8 筆塞 system prompt | LOCAL_CONTRACT |
| `synced` | LIVE（誠實） | **永遠 false** | LOCAL_CONTRACT |
| provenance 欄位（source / createdBy / verified / importance / lastUsedAt / confidence） | STUB | schema 只有 kind/title/content/tags/revision | — |
| 使用者確認後才寫入偏好 | STUB | Agent 不會提案；UI 是手動 CRUD | — |
| 遠端 write → read-back | unsupported | 無 Hermes memory endpoint | 保持 unknown / unsupported |

### Zeabur

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| 權杖保存（masked） | LIVE / LOCAL_VERIFIED | 設定 → 連線 → vault | LOCAL_CONTRACT, LOCAL_BROWSER |
| test / list / variables keys | LIVE / LIVE_UNVERIFIED | POST `/api/settings/zeabur` → GraphQL | LOCAL_CONTRACT mock；LIVE = UNVERIFIED |
| update_env / push keys / redeploy / restart | LIVE / LIVE_UNVERIFIED | **無 confirmation**；Origin + 限流 | LOCAL_CONTRACT mock |
| 操作後 health 再檢查 | STUB | 沒有 | — |

### Tamkang MCP

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| 設定 URL／token | LIVE / LOCAL_VERIFIED | credentials + `/api/settings/tamkang` | LOCAL_CONTRACT |
| initialize + tools/list | LIVE / LIVE_UNVERIFIED | 官方 SDK probe；成功最多 `partial` | LOCAL_CONTRACT fixture |
| 校園帳密換權杖 | PARTIAL | 只猜已知 login 端點，不是 SSO | LOCAL_CONTRACT |
| 真實讀課表／公告 | STUB | Console **不** `tools/call` 淡江工具；名稱 regex 只是 hint | UNVERIFIED |
| Fallback 透明 UI | STUB | 提示詞寫「MCP 離線改網頁」；UI 不顯示已改用哪個來源 | — |

### Research / Audience / Inspiration / Creative

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| researchBundle | STUB | 接到 research mode 任務指示；`executed:false` | LOCAL_CONTRACT |
| 真實文獻／網頁執行 | STUB | 無 Research Executor | — |
| 研究／行政 mode UI | DEAD_CODE（UI） | API 可傳 `assistantMode`；畫面不送 | — |
| Audience Twin API | STUB / LOCAL_VERIFIED | `/api/audience` 規則分數 + `simulation:true` | LOCAL_UNIT／CONTRACT |
| AudienceCard | DEAD_CODE | 元件未掛 | — |
| 靈感板 URL 收藏 | LIVE / LOCAL_VERIFIED | `/api/inspiration` | LOCAL_CONTRACT |
| IG／Pinterest 全站搜尋 | STUB | `fullSiteSearch:false` | LOCAL_CONTRACT |
| Google Sheets 公開 CSV | LIVE / LIVE_UNVERIFIED | 寫死試算表 ID | LOCAL_CONTRACT mock；曾有一次真實 CSV（歷史，非正式工作區） |
| 三方向／文案版本 | LIVE / LOCAL_VERIFIED | workbench `/api/creative` SQLite | LOCAL_CONTRACT, LOCAL_BROWSER |
| 排名／Canva spec | STUB | formatter，非執行 | LOCAL_UNIT |

### Canva / Publish / Social

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| Connect OAuth + 設計清單 | LIVE / LIVE_UNVERIFIED | `/api/canva`；verify = list designs → `partial` | LOCAL_CONTRACT |
| Autofill／上傳／匯出 | LIVE / LIVE_UNVERIFIED | MCP `canva_*` 在授權後才列出 | LOCAL_CONTRACT mock；「不是 live Canva」 |
| CanvaResult 卡片 | REGRESSED | 只在到不了的「任務」nav 分支 | — |
| IG 正式發佈 | DORMANT | `enabled:false`；confirm 後仍拒絕 | LOCAL_CONTRACT |
| Pinterest API | STUB | 限制說明 | — |

### Agents / MCP / Usage / Budget

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| Agent 八角色目錄 | PARTIAL | `ROLE_META` 寫死；只 hydrate `general` | LOCAL_CONTRACT |
| 平行 agent 執行 | STUB | 最多 3 個 **Console 任務**，不是 agent pool | — |
| Workspace MCP | LIVE / LOCAL_VERIFIED | `/api/mcp` 真的 `tools/call` | LOCAL_CONTRACT |
| 外部 MCP registry | PARTIAL | 只 initialize／list；生產路徑不會 `verified` | LOCAL_CONTRACT |
| Usage 報表 API | LIVE / PARTIAL | `/api/usage` 存在；設定頁**沒呼叫**，只用 task.usage | LOCAL_CONTRACT |
| Budget planner FAST/BALANCED/DEEP | STUB | `budgets.ts` 幾乎沒接到 executor | DEAD_CODE `withinBudget` |
| `/api/intelligence` | LIVE wrapper | 202 + 真 task；UI 沒呼叫 | LOCAL_CONTRACT |
| `/api/tool` | DEAD_CODE | 410 | — |
| `/api/brain` | STUB | longTerm/project 恆 null | — |
| `collaboration.ts` | DEAD_CODE | 未引用 | — |

### Settings / Security / Persistence

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| 憑證 vault | LIVE / LOCAL_VERIFIED | AES-256-GCM + SQLite ciphertext；GET last4 | LOCAL_CONTRACT |
| 可選 gateway | LIVE | 未設 secret 時 API 開放 | LOCAL_CONTRACT |
| Origin / 限流 | LIVE | mutation Origin；240/60s **整區一個桶** | LOCAL_CONTRACT |
| 確認 token | PARTIAL | 用於 MCP disable、IG（仍關閉）；**Zeabur／Memory delete／Canva create 沒用** | LOCAL_CONTRACT |
| InvitationGate / MemberAccess / `/api/auth` | DORMANT | 不擋 `/` | LOCAL_CONTRACT no-login |
| `security.login()` | DEAD_CODE | 無 route 呼叫 | — |
| SQLite + uploads + vault.key | LIVE | `CONSOLE_DATA_DIR` | LOCAL_CONTRACT |
| 多 replica | unsupported | in-memory workers／SSE／單機 SQLite | 文件尚未寫 MULTI_REPLICA_READINESS |
| `/create` SillyWorld | REGRESSED | 無 `app/create` | 歷史 404 |

### UI / Turtle / Mobile

| Feature | Class | Trace | Evidence |
| --- | --- | --- | --- |
| 主介面方向 | LIVE | 明亮、對話優先 | LOCAL_BROWSER |
| 龜龜狀態 | LIVE | `turtleState(task)`；無 setTimeout 假研究 | LOCAL_UNIT |
| 任務事件對話 | PARTIAL | 設定 dialog 內「真實事件紀錄」 | LOCAL_BROWSER |
| Task Status Pill / Bottom sheet steps | STUB | 無 pill；≤600px dialog 變 bottom sheet，但不是任務步驟表 | — |
| 390px 龜龜 | PARTIAL | compact turtle `display:none` at ≤380px | LOCAL_BROWSER 歷史 |
| HermesConsole 體積 | PARTIAL | **2119 行**；尚未拆 ConsoleShell／ConversationView／TaskStatus | — |
| Welcome.tsx | DEAD_CODE | 未 import；歡迎畫面內嵌 | — |

---

## What is missing vs the Agent OS contract

| Contract piece | Baseline |
| --- | --- |
| Capability Certification Layer | 不存在。health／integrations 是粗粒度 Connected／partial |
| Per-capability Hermes matrix | 不存在。models 成功 ≠ chat/runs/tools/memory |
| Zeabur read-only certification | test/list/variables 有；沒有分開的 capability 紀錄，也沒有禁止把 test 當全部 verified |
| Context Engine | 無 `lib/server/context/`；prompt 直接拼接 |
| Goal Interpreter | 無 |
| Planner / Tool Router / Fallback | 無 orchestrator；fallback 不可見 |
| Research Executor | plan only |
| Truth classes on all outputs | Audience 有 SIMULATION；其餘沒有統一 FACT／SOURCE_VERIFIED／INFERENCE |
| Agent Registry 2.0 | 目錄 + general health |
| Budget modes 快速／標準／深入 | 無 UI |
| Resume unknown UX | `uncertain` 狀態有，但沒有「遠端狀態尚未確認」專用流程／禁止重送已存在 |
| Idempotency on Zeabur／memory／Canva | 任務有 requestKey；Zeabur 無 |
| Confirmation on high-risk ops | Zeabur 突變無 confirm |
| Task timeline in chat | 只有最後一個 event summary |
| Memory provenance | 缺欄位；無「是否存成品牌偏好」確認 |
| Persistence / multi-replica / operator security docs | 尚未依本契約建立 |

## Persistence snapshot（refresh / restart / redeploy）

| Store | Refresh | Process restart | Zeabur redeploy without volume | Multi replica |
| --- | --- | --- | --- | --- |
| SQLite records | 在 | 在（同一 data dir） | **不在** | 不安全 |
| uploads / vault.key | 在 | 在 | **不在** | 金鑰分裂 |
| in-memory workers / observers | 在（同 process） | **不在** → chat `uncertain` | 不在 | 分裂 |
| 瀏覽器草稿 | **不在** | 不在 | 不在 | n/a |
| Hermes 遠端 run | 可 reconcile | runs+remoteId 可查 | 視 Hermes 自己的 volume | n/a |
| Hermes 遠端 memory | 未驗證 | 未驗證 | 未驗證 | n/a |

## Security snapshot

- 產品：No Login。這是選擇，不是疏漏。
- 公開 URL + 未設 gateway = 任何人可覆寫 Hermes／MCP／淡江／Zeabur 權杖並重新部署。
- Dockerfile 仍寫死 `CONSOLE_ADMIN_EMAILS=aa0968111723@gmail.com`（邀請模組休眠）。
- 不得偷偷改成會員系統。P7 才寫 `OPERATOR_SECURITY.md` 與 optional lock。

## Test commands actually present

- `npm test` — `tests/*.test.ts` 契約；mock Hermes／Zeabur／Canva
- `npm run typecheck`
- `npm run build`
- `npm run check:secrets` — 掃歷史字串，不代表已撤銷
- `npm run test:ui|chat|gateway|workbench|entry` — Playwright；不是 live 平台
- 本 branch 第一個 commit 尚未跑測試（docs only）

## Decisions locked for this long task

1. 不重做 homepage／navigation／dark dashboard。
2. 不 merge PR #10。
3. 不把 Connected 當 Verified。
4. 不把 mock 標 Live。
5. 不自動重跑 unknown 任務。
6. 不自動改 Zeabur env／restart／redeploy。
7. 不把 Audience Twin 講成真實新生調查。
8. 不建立第二套 memory。
9. HermesConsole 只增量拆，不整檔重寫。

## Next action

P0：建立 `lib/server/certification/`（types / registry / runner / store / evidence），把 Hermes 與 Zeabur 拆成 per-capability 狀態，並用 `LOCAL_CONTRACT` 測試證明：**models 成功 ≠ chat verified ≠ 整個 Hermes verified**。
