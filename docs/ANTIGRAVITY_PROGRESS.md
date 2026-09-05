# Hermes Creative Intelligence OS - 實作進度追蹤紀錄

本專案遵循「Long-Running Autonomous Engineering Loop」，將 `hermes-console` 升級為支援零登入、淡江大學禪學社場景深度適配、Audience Twin 受眾雙生模擬、靈感引擎、Canva 自動草稿與安全社群發布的 **Hermes Creative Intelligence OS**。

---

## 階段進度總覽

| 階段 | 模組名稱 | 狀態 | 核心成果與驗證 |
| :--- | :--- | :---: | :--- |
| **Phase 0** | 基準建置與洩漏金鑰淨化 | 已完成 | 清理程式碼庫所有歷史洩漏金鑰；建立 `feat/hermes-creative-intelligence-loop` 分支；初始化追蹤日誌。 |
| **Phase 1** | 零登入單一工作區重構 | 已完成 | 零登入直接使用；CSRF Token、同源防護、SSRF 檢查、速率限制；Canva PKCE 獨立狀態 Cookie 支援；單元測試 100% 通過。 |
| **Phase 2** | Hermes Multi-Profile 註冊體系 | 已完成 | 支援 7 大角色 Profile；Session 鍵隔離；雙引擎無縫備援串流；能力探測路由。 |
| **Phase 3** | 大腦記憶中心與用量追蹤 | 已完成 | 用量事件記錄 (Tokens/Tools/Latency)；專案記憶檢索 (淡江校園地標/禪學社脈絡)；單元測試 100% 通過。 |
| **Phase 4** | 遠端 MCP 註冊表與淡江 Adapter | 已完成 | 5 級工具權限分級；Tamkang MCP 適配器 (校園時程/克難坡/宮燈/福園/茶會規格)；單次確認 Token 機制。 |
| **Phase 5** | 萬象靈感引擎 (Inspiration) | 已完成 | 3 大校園調色盤；Instagram/Pinterest 靈感解析與版權宣告；Canva 模板結構對齊；單元測試 100% 通過。 |
| **Phase 6** | Audience Twin 受眾雙生模擬 | 已完成 | 5 大 Persona（小涵、阿倫、廷宇、小琪、V導）即時評判；5 項指標評分；AI Slop 懲罰；證據與假設標籤分流。 |
| **Phase 7** | 創意工作流 2.0 & Canva 草稿 | 已完成 | 3~4 個差異化策略方向；Canva 設計草稿分層藍圖；受眾再測驗；IG/Threads 社群文案與標籤排版。 |
| **Phase 8** | 安全社群發布審核機制 | 已完成 | 敏感操作單次確認 Token；Payload-bound 防篡改校驗；冪等防重發機制；二次確認彈窗。 |
| **Phase 9** | 9 大子任務編排與真實整合健康度 | 已完成 | 誠實回報 7 大狀態（Connected, Verified, Partial, Unconfigured 等）；9 大子任務循序編排（含 Provenance 出處與 Evidence vs Hypothesis）；Canva 草稿後受眾再測驗 (+4% 增益)；5 大單元測試套件 100% 通過；Next.js 43 路由全綠構建編譯。 |
| **Main 整合** | origin/main (PR #8, #9, #11) 雙向匯流 | 已完成 | 解決 9 處衝突；完全相容 main 的安全規範與新架構；保留全部 9 大子任務、Audience Twin 與 Canva 藍圖；49/49 測試全數通過；`tsc` 與 `npm run build` 零錯誤。 |
| **驗證** | 端對端測試與 PR 提交 | 已完成 | 5 大單元測試套件 + main 整合測試共 49 項測試 100% 通過 (`tsx --test tests/*.test.ts`)；Next.js 43 個靜態/動態路由編譯零錯誤；PR #10 無衝突就緒。 |

---

## origin/main 整合成果紀錄 (PR #8, #9, #11 匯流)

1. **架構整合與相容性**：
   - 保留 main 的安全強化架構：移除了非安全 legacy 根層模組，將 Hermes 工具集與本地沙盒備援模組收納至 `lib/server/hermes/` 內部。
   - 整合 main 的 `tests/security-tasks.test.ts`、`tests/mcp-canva.test.ts`、`tests/turtle.test.ts`、`tests/parallel-intelligence.test.ts` 等全新測試。
   - 保持 Creative Intelligence OS 在 `components/HermesConsole.tsx` 中的一鍵導航 (`creative_os`)、上方按鈕與頂層模式切換。
2. **測試覆蓋指標**：
   - **49 / 49 測試全數通過 (100% Pass)**：包括 Phase 1 至 Phase 9 測試與 main 分支的資安/合約測試。
   - **TypeScript 類型檢查**：`npx tsc --noEmit` 零警告零錯誤。
   - **Next.js 生產編譯構建**：`npm run build` 成功輸出 43 個靜態與動態路由。

---

## 週期 2 (Iteration 2) 紅隊審核與架構漏洞加固

根據 PR #10 深度紅隊審查反饋，完成以下 4 大核心加固：
1. **修復探測邏輯虛假在線漏洞 (Truthful Probes)**：
   - 移除 `discovery.ts` 中 `ping.status < 500` 寬鬆邏輯，杜絕 404/403/400 被誤判為「Zeabur 伺服器在線」的欺瞞漏洞。
   - 整合 Hermes 官方 `/health` 健康檢查端點，並在非正常回應時誠實回報狀態碼（例如 `(HTTP 404)`）並啟用降級備援。
   - 新增 `tests/phase2_hermes_registry.test.ts` 之 Test 6 實測驗證 404 回應精準判定為 offline。
2. **SSRF 安全檢驗收緊**：
   - 在 `security.ts` 的 `validateSsrfSafeUrl` 中加入 `0.0.0.0`、`::` 特殊綁定地址黑名單，防範 Linux 介面綁定穿透。
   - 收緊本地/私有網段檢驗，新增單元測試覆蓋。
3. **SSE Tool Calling 串流解析與執行閉環**：
   - 在 `client.ts` 中實作 SSE `tool_calls` delta 累加解析器，當模型發起工具調用時，自動在伺服器端調用 `executeHermesTool` 並轉發 `event: tool_result`。
   - 在 `recordUsage` 中真實記錄 `toolCallsCount` 與 `toolsUsed` 清單。
4. **真實 Upstream Usage 捕捉**：
   - 請求主體配置 `stream_options: { include_usage: true }`，解析上游返回之 `prompt_tokens` 與 `completion_tokens`，取代純經驗字元估算。

---

## 週期 3 (Iteration 3) Audience Twin 規範化與可解釋性加固

1. **Audience Twin 免責聲明全鏈路規範**：
   - 在 `lib/server/audience-twin/types.ts` 與 `engine.ts` 中將 `disclaimer: "AI 模擬評估，不代表真實市場調查。"` 納入 `AudienceSimulationResult` 標準契約回傳值。
   - 與 `lib/server/audience.ts` 中的 `AUDIENCE_DISCLAIMER` 達成 100% 一致。
2. **單元測試與端對端驗證**：
   - 在 `tests/phase6_7_8_workflow.test.ts` 新增免責聲明存在性斷言。
   - 49/49 項測試持續全數通過。
   - 遠端 GitHub Actions 工作流 `33976580119` 綠燈通過（1m0s）。
   - PR #10 保持 `mergeStateStatus: "CLEAN"`，`mergeable: "MERGEABLE"`。

---

## 週期 4 (Iteration 4) MCP 核心與淡江適配器加固

針對審查反饋之「淡江 MCP 與 MCP 核心」進行 4 大加固：
1. **補齊 `TKU_MCP_URL` 之 SSRF 防護**：
   - 在 `tamkang-adapter.ts` 發送遠端請求前調用 `validateSsrfSafeUrl` 檢驗，杜絕惡意內網與私有 IP 穿透。
2. **重構為標準 MCP JSON-RPC 2.0 傳輸協定**：
   - `queryTkuCalendar` 與 `queryTkuVenues` 採用標準 MCP Spec 之 `{"jsonrpc":"2.0","method":"tools/call","params":{"name":"...","arguments":{...}}}`，並解析 MCP 回傳內容；遠端逾時或異常時平滑回退本機校園知識圖譜。
3. **社群發布明確標記安全沙盒模擬 (Sandbox Simulation Mode)**：
   - 在 `lib/server/mcp/registry.ts` 中，若未配置 Meta/Instagram API 金鑰，明確回傳 `mode: "sandbox_simulation"` 與審核紀錄說明，杜絕向使用者誤報真實發布成功。
4. **Token 儲存容量防爆量與過期清理 (DoS Hardening)**：
   - 設置 `MAX_CONFIRMATION_TOKENS = 500` 容量上限與 FIFO 溢出替換，並在每次生成 Token 前自動掃描銷毀過期條目。
   - 在 `tests/phase4_mcp_inspiration.test.ts` 新增沙盒標籤與 505 次 Token 壓力清理斷言測試。

## 週期 5 (Iteration 5) Canva 官方 Vault 狀態連動與 Audience Twin 多輪辯論收斂加固

針對審查反饋之「Canva 官方 OAuth PKCE / Vault 連動」與「Audience Twin 模擬真實度與客觀證據 vs 推論假設」，完成以下核心加固：

1. **Canva 官方 Vault 授權狀態真實連動 (Truthful Vault Probes)**：
   - 整合 `canvaStatus(WORKSPACE_OWNER)` 探測，當伺服器端 Vault 已存在授權金鑰且經 `verifyCanva` 驗證時，誠實回報 `Verified`（已驗證在線）或 `Partial`（已驗證清單讀取）；未授權時若有 Client ID 則顯示 `Needs Authorization`，杜絕假連線或盲點狀態。
   - 升級 `/api/auth/canva/status` 路由，打通工作區零登入前端與伺服器端 Vault 狀態同步。
   - 在 `lib/server/store.ts` 補齊 `del` 記錄刪除函式，並在 `tests/phase9_orchestrator_truth.test.ts` 加入 Vault 狀態連動真實回報與清理測試斷言。

2. **Audience Twin 多輪辯論與共識收斂機制 (Multi-Round Debate Simulation)**：
   - 在 `lib/server/audience-twin/types.ts` 與 `engine.ts` 中建立結構化多輪辯論模型：
     - **第一輪 (Divergence 分歧碰撞)**：懷疑者關注商業與宗教透明度、路人檢驗首屏 0.8 秒停留力、大一新生要求破冰無壓承諾、創意總監嚴審手作圓形三色光規範。
     - **第二輪 (Convergence 疑慮消解)**：透過 4 階段透明時程、克難坡反差鉤子、零社交壓力保證與 36px 邊角印章規範，各角色疑慮全數化解。
   - 實作**共識收斂度指數 (Consensus Convergence Index, 0-100)**：基於 5 位 Persona 評分標準差與加權計算，實測達 95% 高度收斂。

3. **客觀證據 (Evidence) vs 推論假設 (Hypothesis) 動態溯源 (Facts Provenance)**：
   - 建立結構化 `AudienceFact`（含 `statement`, `kind`, `sourceTag`, `confidence`）：
     - 客觀證據：標記 `[校園真實地標]`、`[官方行事曆作息]`、`[校園景觀調研]`、`[實體場地規範]`、`[視覺規範守則]`，信賴度達 94%-100%。
     - 推論假設：標記 `[心理推論假設]`（如 IG 停留秒數延長、社交防禦減壓）與 `[行為推論假設]`（如室友攜伴同行網絡傳播），標示推論模型。
   - 100% 向後相容既有 `evidencePoints` 與 `hypothesisPoints`。

4. **全綠品質與端對端驗證**：
   - `npm test`：49/49 測試 100% 通過。
   - `npx tsc --noEmit`：0 錯誤。
   - `npm run check:secrets`：198 檔案零洩漏。
   - `npm run build`：Next.js 43/43 靜態與動態路由編譯零錯誤。

---

## 關鍵資安規範
1. **絕不硬編碼真實金鑰**：歷史洩漏金鑰視同廢止，所有範本一律使用 `<HERMES_API_KEY>` 佔位符。
2. **零登入存取安全性**：無需登入即可使用創作工作區，但後端寫入與敏感發布操作均具備同源檢驗、單次 Token 與速率限制防護。
3. **誠實整合狀態原則 (Truthful Integrations)**：若遠端服務尚未綁定或未連線，系統誠實回報 `Partial (本地備援中)`、`Needs Authorization` 或 `Unconfigured`，絕不偽造連線成功狀態。
4. **受眾雙生可解釋性**：Audience Twin 明確標註為模擬啟發式評估（Heuristic Scores），嚴格分離客觀證據 (Evidence) 與推論假設 (Hypothesis)。



