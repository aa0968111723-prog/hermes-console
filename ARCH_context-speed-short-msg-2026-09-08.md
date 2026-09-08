# 架構｜短訊息上下文／速度（hermes-console）

**現象（使用者截圖）**：創作對話任務詳情 — 實際模型 `hermes-agent`，輸入 **107,761** tokens、輸出 2,173、耗時 **50.1s**；執行計畫第一步「讀取專案上下文」。

**結論**：不是「assembler 真的把整庫塞進 10 萬 token」這麼單純——`fitBudget` 標準檔只有 ~1800（且中文 token 估偏小）。真正膨脹來自 **每輪無窗歷史 + 永遠灌滿的超長 system 工具經 + 短訊仍走完整 orchestration／遠端 agent 工具迴圈**。計畫上的「讀取專案上下文」是固定步驟標題，容易讓人以為每次都在翻庫。

## 送模路徑（main）

`lib/server/tasks.ts` → `prepareOrchestration`（`executor.ts`）→ system `instructions` + **`conversation_history`／messages 幾乎整段歷史** → Hermes `hermes-agent`。

| 層 | 現況 | 對短訊的傷害 |
|----|------|----------------|
| 歷史 | `conv.messages.slice(0, -1)` **無窗** | 長對話每句重送，input 線性爆 |
| System | `creativeInstructions`（多 MCP 經）+ lumen＋framelab **每輪全附** + plan + `assembleContext` + `memoryDigest` | 短「嗯／改一下」也付固定稅 |
| 計畫 | `buildPlan` **永遠**先「讀取專案上下文」「讀取共用記憶」；關鍵字「查／資料」就拉研究鏈 | UX 像翻庫；遠端 agent 易跟著真查 |
| Budget | context `fast/balanced/deep`＝900/1800/3600；`DEFAULT_BUDGET.tokens = null` | 任務級無硬頂；實測 10 萬仍可跑完 |
| 排序 | `relevanceTo` 對繁中弱（Cycle 15） | 相關／無關分不開 → 檢索形同虛設 |
| 遠端 | hermes-agent 工具 schema＋工具結果再進上下文 | Console 側裁完，agent 側又灌一次 |

## 建議機制（依優先）

### P0 — 短訊快路徑（語意閘）
1. **Intent tier**：`chitchat | continue | lookup | create`（規則＋極短分類即可）。  
   - `chitchat`／短 `continue`（≤ N 字、無創作／查資料意圖）：`budgetMode=fast`；**跳過**完整 creative／lumen／framelab 經；計畫只留「回覆」或極簡 1 步。  
   - `lookup`／`create` 才開完整 plan。  
2. **History window**：只送最近 **K 輪**或 **≤ H tokens**；更早的改 **rolling summary**（每專案／每對話存一份）。禁止再 `slice(0,-1)` 全送。  
3. **任務 token 硬頂**：啟用 `CONSOLE_TASK_TOKEN_BUDGET`（或預設 8k～16k input 警戒）；超限改摘要重試或失敗可見，勿默默燒到 10 萬。

### P1 — 指示與檢索分離
4. **Instruction packs**：基底短 system + 依 `interpretGoal`／tier **按需**掛 lumen／framelab／planform／淡江包。  
5. **Retrieve-then-read**：`context_engine`／`shared_memory` 預設只交 **目錄＋分數＋短摘**；全文／PDF／素材經 `workspace_read_material` 等 **點名再讀**。對齊計畫文案「不把整庫塞進提示」。  
6. 落地 Cycle 15：CJK bigram `relevanceTo`、中文 `estimateTokens`、assembler `wrapUntrusted`（否則排序／預算仍騙自己）。

### P2 — 觀測
7. 任務詳情拆帳：system／history／tools／agent 各自 tokens；「讀取專案上下文」步驟標示實際 `packed.used/limit`，避免 UX 誤導。

## 非目標
- 不合／堆 PR #10；自 **main** 開短 PR（柏能點頭／Grok Build）。  
- 不開 Cloud Agent（架構收件）；planform 停。  
- 不把 vault 密文寫進 git／聊天。

## 成功長相
短繼續改（「把語氣改軟一點」）input **≪ 1 萬**、秒級～十秒內；完整「幫我做淡江茶會網宣」才走 deep／多步。詳情看得到 tier 與各段 token。
