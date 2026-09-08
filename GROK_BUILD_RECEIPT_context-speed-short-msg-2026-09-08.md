# Grok Build 收件｜短訊息上下文／速度（自 main）

**日期**：2026-09-08 台北  
**Repo**：https://github.com/aa0968111723-prog/hermes-console  
**基準**：最新 **main** 開**新短 PR**（勿堆 #10）  
**架構說明**：`/workspace/hermes-briefs/ARCH_context-speed-short-msg-2026-09-08.md`  
**證據**：任務詳情 input ≈107k、50s；計畫首步「讀取專案上下文」  
**禁**：Cloud Agent／合 #10／刪檔／planform／改 vault

## 要做（建議同一 PR 或拆 2 刀：P0 先）

### 1. [P0] History window
- **檔**：`lib/server/tasks.ts`（組 `history`／`conversation_history` 處）
- **現在**：`conv.messages.slice(0, -1)` 全送
- **期望**：只送最近 K 則（建議預設 8～12）或累計 token ≤ 預算；更早可選附 1 段 summary 欄位（沒有 summary 就省略）
- **成功**：長對話第二十句起，history 段 tokens 有上界；測鎖定

### 2. [P0] Intent tier → 指示／計畫瘦身
- **檔**：`lib/server/orchestrator/goal.ts`（或新 `intent.ts`）、`planner.ts`、`tasks.ts` 組 `instructions`
- **期望**：
  - 短 continue／寒暄：`budgetMode=fast`；**不**附 lumen／framelab 全經；`buildPlan` 不強制研究／靈感／Canva 鏈；可改為 0～1 步「直接回覆」
  - 完整創作／查資料：維持現況 packs
- **成功**：無關鍵字短訊的 system 明顯短於完整創作訊；測兩條路徑

### 3. [P0] 任務 input token 硬頂
- **檔**：`lib/server/budgets.ts`／任務提交前
- **期望**：預設啟用合理 `CONSOLE_TASK_TOKEN_BUDGET`（或代碼預設非 null）；估到將超限時先裁 history／packs，仍超則可見錯誤，禁止默跑到 10 萬級
- **成功**：人造超長 history 被裁或拒絕；日誌／事件看得到

### 4. [P1] 按需 instruction packs
- **檔**：`lib/server/hermes.ts` `creativeInstructions` 使用處、`lumen`／`framelab` task instructions
- **期望**：基底短經 + goal flags 才 concat 專包
- **成功**：未提 Lumen／FrameLab 的任務指示不含大段 lumen_*／framelab_* 手冊

### 5. [P1] 對齊 Cycle 15 CJK（若 main 尚未合）
- `relevanceTo` Han bigram；`estimateTokens` 中文權重；`formatContextForInstructions` wrapUntrusted  
- 見既有 `GROK_BUILD_RECEIPT_pr10-cycle15-cjk-context-2026-09-08.md`（自 main 開，勿堆 #10）

## 不要做
- 不要刪「讀取專案上下文」文案卻改成真的 list 全表
- 不要為了省 token 關掉 origin／認證閘
- 不要把正式庫 dump 進 git

## 驗收
- 短訊路徑：任務詳情 input 目標 **&lt; 15k**（理想 &lt; 8k）、耗時明顯下降  
- 完整創作路徑仍可用  
- verify 綠；新 PR 描述連到本收件與 ARCH 檔
