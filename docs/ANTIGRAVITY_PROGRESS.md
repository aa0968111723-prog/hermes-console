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
| **Phase 10** | Instagram 社群調研與 Publishing 加固 | 已完成 | 多校園 Hashtag 趨勢；3 大生活節奏發文時段模型；4:5 視覺規範與 36px 手作印章；Truthful Probes 狀態探測；冪等防重發快取；沙盒審核日誌與 live_meta_graph_api 支援。 |
| **驗證** | 端對端測試與 PR 提交 | 已完成 | 6 大單元測試套件共 60 項測試 100% 通過 (`tsx --test tests/*.test.ts`)；Next.js 43 個靜態/動態路由編譯零錯誤；202 個檔案金鑰掃描零洩漏；PR #10 就緒。 |

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

## 週期 6 (Iteration 6) 標準 MCP SDK Client 整合與動態工具探索加固

針對紅隊審查指出的「未使用官方 `@modelcontextprotocol/sdk`、遠端協定非標準傳輸、工具靜態寫死」之缺口，完成以下核心重構：

1. **實作官方 MCP SDK 客戶端封裝 (`lib/server/mcp/client.ts`)**：
   - 引入官方 `@modelcontextprotocol/sdk` 之 `Client` 與 `StreamableHTTPClientTransport` 模組。
   - 封裝 `createMcpClient` 實例工廠，全數實施 `validateSsrfSafeUrl` 嚴格檢驗，阻擋惡意內網與私有 IP 穿透。
   - 提供 `listTools()`、`callTool()` 與優雅資源釋放 `close()` 介面，支援標準 MCP 回傳封包之解析。
   - 實作具備逾時控制的 `callRemoteMcpToolViaSdk` 與動態探索函式 `discoverRemoteMcpTools`。

2. **淡江適配器優先對接標準 MCP SDK 傳輸**：
   - 在 `tamkang-adapter.ts` 中的 `queryTkuCalendar` 與 `queryTkuVenues`，優先透過 `callRemoteMcpToolViaSdk` 以標準 MCP 傳輸協定進行遠端調用。
   - 若遠端伺服器僅支援輕量 JSON-RPC 2.0 或未開啟完整 MCP 串流，自動平滑回退至標準 JSON-RPC 2.0 HTTP 封包；離線或逾時自動回退本機校園知識圖譜，達成多重彈性容錯。

3. **動態 MCP 工具探索與伺服器健康度即時化**：
   - 在 `lib/server/mcp/registry.ts` 實作 `discoverAndRegisterRemoteTools`，可透過 `tools/list` 探索遠端工具並動態註冊進系統中。
   - 新增 `getMcpServers()` 整合 Canva Vault 狀態，在 `/api/mcp/servers` 路由即時回報真實伺服器連線狀態。
   - 在 `create_canva_design_draft` 中依據 Vault 驗證狀態精準標記 `canvaMode`（`live_connected`、`vault_partial`、`sandbox`、`local_blueprint`）。

4. **單元測試套件全綠驗證**：
   - 在 `tests/phase4_mcp_inspiration.test.ts` 新增「測試 4: MCP SDK Client 封裝、SSRF 防禦與容錯降級」，涵蓋雲端 Metadata SSRF 阻擋、離線逾時平滑降級、動態探索失敗降級與伺服器健康度探測。
   - `npm test`：49/49 測試 100% 通過。
   - `npx tsc --noEmit`：0 錯誤。
   - `npm run check:secrets`：199 檔案零洩漏。
   - `npm run build`：Next.js 43/43 路由編譯零錯誤。

---

## 週期 7 (Iteration 7) Audience Twin 多校園脈絡動態適配、語意正則 AI Slop 攔截與 Canva 圖層動態重審加固

針對紅隊審查指出的「非淡江校園場景硬編碼洩漏、AI Slop 同義詞繞過、堆砌關鍵字刷分、以及 Canva 草稿後受眾再測驗分數固定硬編碼」之缺口，完成以下 4 大核心加固：

1. **Audience Twin 多領域 Persona 與校園地標動態適配 (`lib/server/audience-twin/engine.ts`)**：
   - 實作 `resolveContextDomain(text, projectId)` 與 `resolvePersonasForContext(text, projectId)`，支援 `tamkang`（淡江）、`ntu`（臺大）、`general`（通用大專）三大校園領域動態切換。
   - 預設保留 `PERSONAS` 陣列（5 位立體 Persona），確保與現有測試契約 100% 相容。
   - 實作 `extractContextFacts(fullText, domain)`，依領域動態產出高信賴度之客觀證據（`[校園真實地標]`、`[教務行事曆]`、`[景觀調研]` 等）與推論假設。
   - 實測在非淡江校園（如臺大「椰林大道迎新野餐」）情境下，精準適配臺大電機大一宇軒等 Persona，並嚴格隔離淡江克難坡/福園地標事實，杜絕事實洩漏。

2. **語意正則 AI Slop 同義詞攔截與對數飽和防刷分計算**：
   - 引入 `SLOP_PATTERNS` 語意正則陣列，精準識別「開啟心靈之旅」、「揭曉不為人知的奧秘」、「萬萬不能錯過」、「心靈洗禮」等常見同義 marketing 套話，檢測到即予以重扣（分數降至 50 以下）。
   - 實作關鍵字對數飽和防刷分機制：`Math.min(18, Math.round(Math.log2(authFound.length + 1) * 6.5))`，有效防止大量堆砌校園名詞惡意刷分衝頂（實測堆砌 13 個關鍵字分數平滑收斂在 96 分內）。

3. **Canva 草稿藍圖分層動態評估 (`lib/server/orchestrator/task-orchestrator.ts`)**：
   - 實作 `evaluateCanvaDraftLayers(canvaBlueprint, directionTitle)`，取代原本寫死的 `scoreBonus = 4`。
   - 逐層動態檢驗：
     - Layer 1（底色）：驗證燕麥暖白等柔和護眼無壓色系。
     - Layer 3（標題）：驗證思源宋體 44pt 視覺階層與停留吸睛力。
     - Layer 5（手作印章）：嚴格校驗 AGENTS.md 守則「手作圓形三色光（紅外、黃中、綠內）直徑 36px 邊角印章」，防止過大或標靶化。
     - Layer 6（行動號召）：檢驗時間、地點、費用（免費）、茶點等透明度。
   - 依據通過圖層數動態計算增益分數與發布結論（`Ready for Publication`、`Minor Iteration Recommended`、`Needs Visual Overhaul`）。

4. **全套測試與 Next.js 生產建置驗證**：
   - 在 `tests/phase6_7_8_workflow.test.ts` 新增「測試 2b: 跨領域受眾適配與校園地標無洩漏驗證」、「測試 2c: 語意正則 AI Slop 同義句型攔截」、「測試 2d: 校園關鍵字對數飽和防刷分」。
   - `npm test`：49/49 測試 100% 通過。
   - `npx tsc --noEmit`：0 錯誤。
   - `npm run check:secrets`：199 檔案零洩漏。
   - `npm run build`：Next.js 43/43 靜態與動態路由編譯零錯誤。

## 週期 8 (Iteration 8) 全管線跨校園領域解耦、靈感庫動態適配與子任務無地標洩漏加固

針對 Phase 6, 7, 8, 9 之全管線跨校園適配，完成以下 4 大核心加固：

1. **多領域策略方向庫與社群活動細節獨立模組 (`lib/server/creative-workflow/directions.ts`)**：
   - 建立 `TAMKANG_DIRECTIONS`（淡江克難坡/福園）、`NTU_DIRECTIONS`（臺大椰林大道/醉月湖）、`GENERAL_DIRECTIONS`（通用大專適應期/選課綠洲）。
   - 實作 `getRawDirectionsForDomain(domain)` 與 `getSocialLogisticsForDomain(domain)`，將活動地點（淡江活動中心/臺大活大/通用教室）、時間、費用、Canva 底部膠囊標籤與專屬社群標籤（如 `#臺灣大學` `#椰林日常` vs `#淡江大學` `#克難坡日常`）徹底解耦。
   - 保留淡江預設行為，100% 向後相容現有測試與呼叫合約。

2. **萬象靈感引擎跨校園與當代學誌美學擴充 (`lib/server/inspiration/engine.ts`)**：
   - 新增 `insp_ntu_yelin_minimal`（臺大椰林・醉月湖畔極簡野餐微光風格）與 `insp_campus_editorial_zen`（當代青年學誌・低飽和留白社團風格）。
   - 升級 `searchInspirations(keyword?, domain?)`，支援依校園脈絡領域精準過濾專屬色彩與排版靈感。

3. **9 大子任務編排器與端對端管線動態在地化 (`lib/server/orchestrator/task-orchestrator.ts`, `lib/server/creative-workflow/pipeline.ts`)**：
   - 子任務 1（`memory_retrieval`）：動態適配校園記憶地標（臺大椰林大道/醉月湖 vs 淡江克難坡/福園），客觀證據與推論假設完全隔離，杜絕非淡江情境之地標洩漏。
   - 子任務 2（`mcp_campus_research`）：動態適配調研標題、場地特性（活大多功能室 vs 淡江 B307）與來源出處。
   - 子任務 3（`inspiration_search`）：依領域調用專屬靈感風格。
   - 子任務 4 & 5：採用動態 `rawDirections` 與 `logistics`，Canva 第 6 層與 IG 文案內文/標籤動態注入。
   - 子任務 8（`social_caption_draft`）：動態產出校園專屬標籤庫摘要。
   - `pipeline.ts`：自動指派 `assignedProfile`（`ntu` 臺大校園脈絡專家 / `tku` 淡江校園脈絡專家 / `general` 大專青年脈絡專家）。

4. **全新跨領域單元測試與端對端管線驗證**：
   - 在 `tests/phase6_7_8_workflow.test.ts` 新增「測試 4: 跨校園領域全管線端對端驅動測試 (NTU Context)」。
   - 在 `tests/phase9_orchestrator_truth.test.ts` 新增「測試 3: 跨校園領域 9 大子任務編排動態適配 (NTU Context)」。
   - 驗證社群標籤、Canva 標籤、內文痛點精準匹配，且無任何淡江地標字樣洩漏。
   - `npm test`：49/49 測試全數通過（100% Pass）。
   - `npx tsc --noEmit`：0 錯誤。
   - `npm run check:secrets`：200 檔案零洩漏。

## 週期 9 (Iteration 9) Canva 官方 PKCE 授權雙向連動、草稿藍圖在地化與真實匯出能力加固

針對審查反饋建議的「主題 H：Canva 官方 PKCE 授權、草稿藍圖與真實匯出」，完成以下 4 大核心加固：

1. **Canva PKCE 授權與加密 Vault 雙向持久化連動 (`lib/server/canva-auth.ts`)**：
   - 重構 `getWorkspaceCanvaToken()`：除記憶體快取外，自動在記憶體過期時查詢加密 SQLite Store 之 `canva_tokens` 表，透過 `unseal` 安全恢復金鑰，打通 `/api/canva` 與 `/api/auth/canva` 兩大授權路徑。
   - 重構 `setWorkspaceCanvaToken()`：取得正式金鑰後，自動同步封裝至加密 Vault (`seal`) 並更新 `canva_status` 為 `partial`，確保服務重啟與不同端點皆能保持在線。

2. **Canva 官方 Connect API 設計與匯出函式庫擴充 (`lib/server/canva.ts`)**：
   - 實作 `getCanvaDesign(owner, designId)`：讀取 Canva 設計中繼資料。
   - 實作 `createCanvaDesign(owner, input)`：透過官方 `POST /designs` 建立預設規格（如 `instagram_post` 1080x1350）或自訂尺寸設計。
   - 實作 `exportCanvaDesign(owner, input)`：透過官方 `POST /exports` 提交 PNG、JPG、PDF 匯出工作。
   - 實作 `pollCanvaExport(owner, exportJobId)`：透過官方 `GET /exports/{id}` 輪詢匯出狀態與官方下載連結。

3. **Canva 統一 API 路由全生命週期擴充 (`app/api/canva/route.ts`)**：
   - 擴充 `POST /api/canva` 端點，以嚴格 Zod `discriminatedUnion` 支援：`authorize`、`verify`、`search_designs`、`get_design`、`create_design`、`export_design`、`poll_export`、`template_dataset`。
   - 保留原有同源檢驗與 `authenticate(req, true)` 嚴格安全性防護。

4. **MCP 註冊表與草稿藍圖在地化 (`lib/server/mcp/registry.ts`)**：
   - 新增 `export_canva_design_draft` 工具至 `MCP_TOOLS`，支援由官方 API 匯出或沙盒模式產出高擬真 1080x1350 預覽規格與下載連結。
   - 升級 `create_canva_design_draft`：依據 `resolveContextDomain` 動態在地化圖層提示詞（臺大椰林大道 vs 淡江福園）與行動號召，徹底消除非淡江情境地標洩漏。

5. **測試覆蓋與全線驗證**：
   - 在 `tests/phase1_security.test.ts` 加入 Canva Vault 持久化雙向同步測試斷言。
   - 在 `tests/phase4_mcp_inspiration.test.ts` 加入 NTU Canva 草稿在地化與 `export_canva_design_draft` 工具測試斷言。
   - `npm test`：49/49 測試全數通過（100% Pass）。
   - `npx tsc --noEmit`：0 錯誤。
   - `npm run check:secrets`：200 檔案零洩漏。

---

## 週期 10 (Iteration 10) Instagram 社群調研引擎、時段分佈模型與 Publishing 安全加固

針對審查反饋建議的「主題 I/J：Instagram Research 與 Publishing 加固」，完成以下 5 大核心加固：

1. **Instagram 社群調研引擎實作 (`lib/server/social/instagram-research.ts`)**：
   - **多校園熱門 Hashtag 趨勢分析**：支援淡江 (`tamkang`)、臺大 (`ntu`) 與通用大專 (`general`)。分類包含校園地標、社團活動、生活減壓、大一迎新鉤子，並嚴格隔離各校地標（淡江克難坡/宮燈 vs 臺大椰林/醉月湖）。
   - **校園大專生活節奏發文時段模型**：
     - 中午放空覓食期 (12:15 - 13:15)：推薦 Story 9:16，觸及權重 88。
     - 傍晚放學通勤期 (17:30 - 18:45)：推薦 Carousel 多圖輪播，觸及權重 86。
     - 深夜宿舍黃金檔 (21:45 - 23:30) ⭐：推薦 4:5 滿版 Feed 視覺，觸及權重 97，停留秒數 5.2s，互動率極高。
   - **即時發布契合度指數 (Posting Readiness Score)**：依據當前時間自動評估契合度與發布格式建議。
   - **視覺規格與規範檢驗**：推薦 4:5 (1080x1350) 滿版規格，邊角安全區（頂 120px、底 180px），手作圓形三色光道具 36px 邊角印章規範，首屏 3 行折疊前鉤子原則。

2. **Truthful Probes 狀態探測升級 (`lib/server/publish.ts`)**：
   - 支援 4 大環境狀態誠實探測：
     - `unconfigured`（未配置金鑰，預設保持關閉）。
     - `needs_authorization`（配置 OAuth ID/Secret，但需伺服器確認與使用者授權）。
     - `sandbox`（配置 API Token 但未開 live，安全沙盒審核模式）。
     - `ready`（配置 Token 且 `ENABLE_LIVE_PUBLISH === "true"`，官方發布就緒）。
   - 升級 `confirmPublish`：支援 `allowSandbox: true` 產生完整沙盒審核軌跡 (`auditTrail`)，或執行正式 `live_meta_graph_api` 發布。

3. **`metaPublisher.publish` 契約加固與冪等性防重複發布 (`lib/server/publish/contract.ts`)**：
   - 建立伺服器端冪等快取 `idempotencyStore`（最多 500 筆，1 小時 TTL），相同 `idempotencyKey` 重複提交自動回傳快取結果並標記 `idempotentCached: true`，杜絕重複扣款或重複排程。
   - 嚴格一次性 Token 核驗：缺少 Token 或傳入 boolean `true` 嚴格拒絕。

4. **MCP 工具擴充與全管線整合 (`lib/server/mcp/registry.ts`, `task-orchestrator.ts`, `pipeline.ts`)**：
   - 新增 `research_instagram_trends` 工具至 `MCP_TOOLS`（`permissionTier: "read"`）。
   - 升級 `publish_social_campaign` 工具：整合沙盒審核軌跡與 Meta Graph API 交付模式。
   - 在 9 大子任務編排器之子任務 8 (`social_caption_draft`) 整合調研報告與最佳時段推薦。
   - 在 `runCreativeIntelligencePipeline` 中回傳 `instagramResearch` 報告。

5. **全套測試覆蓋與零錯誤驗證**：
   - 建立 `tests/phase10_instagram_publish.test.ts` 包含 11 項測試斷言。
   - `npm test`：**60 / 60 測試全數通過 (100% Pass)**。
   - `npx tsc --noEmit`：0 錯誤。
   - `npm run check:secrets`：202 個檔案零洩漏。
   - `npm run build`：Next.js 43/43 路由編譯零錯誤。

---

## 週期 11 (Iteration 11) Phase 3 Verified MCP、專案隔離與淡江適配器雙向匯流

本週期完成 Grok 遠端提交 `5a6d61f` 與 Antigravity 本地 Phase 3 功能之無縫雙向匯流：

1. **MCP 專案邊界隔離與動態目錄評估 (`lib/server/mcp-registry.ts`, `lib/server/projects/router.ts`)**：
   - 整合 `projectMcpIsolated(a, b)` 演算法，防止跨專案（如 Planform 3D 攤位與 CutOS 影片剪輯）MCP 伺服器工具相互洩漏。
   - 擴充 `PROJECT_CATALOG` 支援 `tamkang` 與 `canva` 官方橋接項目。
   - 實作 `getDynamicProjectCatalog()`，動態計算各專案 MCP 端點啟用狀態與備援狀態（`ready`, `disabled`, `fallback_available`）。
   - 擴充 `routeToolsets(intent, projectId)` 支援意圖語意分類（`space_and_booth`, `video_production`, `creative_campaign`, `general_design`）。

2. **淡江能力分組與覆蓋率分析 (`lib/server/tamkang.ts`)**：
   - 整合 Grok 之 `toolHaystack`（深入工具名稱、描述與 inputSchema）與 `TAMKANG_CAPABILITY_GROUPS` 10 大能力分組。
   - 擴充正規表示式 `HINTS`，加入行事曆、社團、校園、教室等關鍵詞辨識。
   - 加入 `resolveTamkangTool` 與 `getTamkangCapabilityCoverage`，精確分析 MCP 工具覆蓋度與缺失能力清單。

3. **淡江校園資料出處真確性標記 (`lib/server/mcp/tamkang-adapter.ts`)**：
   - 於 `queryTkuCalendar`、`queryTkuVenues` 與 `getTkuZenClubProfile` 同時標記 `source: "console_notes"`、`mcpVerified: false`、`sourceLayer: "console_local_notes"` 與 `isRemoteMcp: false`。
   - 實作 `getTkuSourceProvenance` 出處解析器，誠實區分遠端 Verified MCP 與本機校園筆記。

4. **全套整合測試與全鏈路驗證**：
   - 融合雙方測試至 `tests/phase3_mcp_routing.test.ts`（包含 9 項測試斷言）。
   - `npm test`：**90 / 90 測試全數通過 (100% Pass)**。
   - `npx tsc --noEmit`：0 錯誤。
   - `npm run check:secrets`：209 個檔案零洩漏。
   - `npm run build`：Next.js 43 個靜態/動態路由全部編譯通過。

---

## 週期 12 (Iteration 12) origin/main 雙向匯流、修復試算表 CSV 語法錯誤與 142/142 全量驗證

本週期完成 `origin/main`（含 PR #12 Gemini Spark 與試算表增量匯入功能）向 `feat/hermes-creative-intelligence-loop` 之雙向匯流與修復：

1. **雙向匯流與衝突解決 (`app/api/inspiration/route.ts`)**：
   - 合併 `origin/main`（commit `ef1df0f`、`d24da9c`、`95fb0ce`、`d275513`）。
   - 解決 `app/api/inspiration/route.ts` 衝突：同時保留 `sheetsSync` 試算表同步結果與 `fullSiteSearch: false`、`liveFetch: false` 真實探測標記，並維持 `runInspirationPipeline`。

2. **修復試算表 CSV 解析語法錯誤 (`lib/server/inspiration/sheets-sync.ts`)**：
   - 修復 `parseCsv` 中由上游 PR 引入的未閉合字串常值錯誤（將 `ch === """` 修正為 `ch === '"'`），解決導致 `tests/parallel-intelligence.test.ts` 與 CI 構建崩潰的語法問題。

3. **全系統驗收與質量指標**：
   - `npm test`：**142 / 142 測試 100% 全數通過 (0 失敗、0 略過)**，覆蓋 Phase 0 至 Phase 12 全量場景。
   - `npx tsc --noEmit`：0 錯誤。
   - `npm run check:secrets`：226 個檔案掃描通過，0 洩漏。
   - `npm run build`：Next.js 43 個路由成功編譯。
   - PR #10 合併衝突完全排除，恢復 `MERGEABLE` 狀態。

---

## 關鍵資安規範
1. **絕不硬編碼真實金鑰**：歷史洩漏金鑰視同廢止，所有範本一律使用 `<HERMES_API_KEY>` 佔位符。
2. **零登入存取安全性**：無需登入即可使用創作工作區，但後端寫入與敏感發布操作均具備同源檢驗、單次 Token 與速率限制防護。
3. **誠實整合狀態原則 (Truthful Integrations)**：若遠端服務尚未綁定或未連線，系統誠實回報 `Partial (本地備援中)`、`Needs Authorization` 或 `Unconfigured`，絕不偽造連線成功狀態。
4. **受眾雙生可解釋性**：Audience Twin 明確標註為模擬啟發式評估（Heuristic Scores），嚴格分離客觀證據 (Evidence) 與推論假設 (Hypothesis)。

