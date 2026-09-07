# Post-PR20 多階段長任務

基準：`main` 已合併 PR #20。本文件是下一輪長任務的執行藍圖，不代表下列能力已完成。

## 目標

把 Hermes Console 從功能集合收斂成可長任務執行、可自動選工具、可驗證外部能力、可恢復任務、可管理共用記憶、可清楚呈現來源與進度的 Agent Operating Console。

## 執行原則

- 以 current `main` 為唯一基準。
- 不直接合併舊 PR #10；只做能力盤點與必要移植。
- 不重做整套 UI，不另開網站。
- 不顯示 chain-of-thought，只顯示可審查的步驟、工具事件、來源與證據。
- Local test、mock、browser test 與 live external verification 必須分開標示。
- 高風險或有副作用的操作必須保留使用者確認。
- 長任務以 `docs/LONG_TASK_PROGRESS.md` 持續記錄與接續。

## Phase 0：PR20 基準盤點

建立 `docs/POST_PR20_BASELINE.md`，把 Shared Memory、Zeabur、Hermes、MCP、Tamkang、Canva、Research、Audience、Inspiration、Usage、Agent Registry 分成：LIVE、LOCAL_VERIFIED、LIVE_UNVERIFIED、PARTIAL、STUB、DORMANT、REGRESSED、DEAD_CODE。

盤點必須追 UI → API → server module → persistence → external service，不可只看檔名判定完成度。

## Phase 1：Capability Certification

建立統一 certification layer，逐 integration / capability 保存狀態、最後檢查時間、延遲、可展示證據與錯誤摘要。禁止把單一 HTTP 成功視為整個整合已驗證。

## Phase 2：Hermes Certification

逐項驗證 Hermes API、認證、models、chat、streaming、runs、stop/cancel、tools、skills、MCP、memory、image input、usage 等能力，形成 capability matrix。

## Phase 3：Zeabur Certification

沿用 PR20 既有 Zeabur 模組，先補 read-only live certification 與真實狀態呈現。有副作用的操作仍維持明確確認流程，且操作完成後要重新檢查服務健康度。

## Phase 4：Shared Memory Provenance

延伸 shared memory 的來源、驗證狀態、重要度、最後使用時間、專案範圍與 revision。Agent 不得把任意聊天內容自動變成長期記憶；可提出保存建議，但需使用者確認。

## Phase 5：Remote Memory Verification

只有 Runtime 真正發現可用的遠端 memory read/write/delete 才啟用。遠端寫入後必須 read-back 驗證；模型文字回覆不能當成同步證據。

## Phase 6：Project Context Engine

建立 context assembler / ranking / budget / provenance。來源包含 Shared Memory、Project、Recent Conversations、Materials、Approved Facts、Selected Inspiration、Creative Directions、Audience Data、Runtime Tools、Current Task、User Input。加入 relevance、recency、importance、source trust 與 token budget。

## Phase 7：Goal Interpreter

將使用者自然語言需求整理成結構化 Goal：目標、受眾、輸出、限制、是否需要研究、是否需要受眾模擬、是否需要設計工具。只保存結構化規劃，不保存內部推理。

## Phase 8：Planner

依 Goal、Context、Available Agents、Available Tools、Certification、Budget 產生 ExecutionPlan。每個 step 至少包含 title、purpose、dependencies、agent、tool、fallback、status。

## Phase 9：Tool Router

依 capability、certification、permissions、latency、cost、data quality、risk 自動選工具，避免讓使用者手動理解 MCP / Agent / Tool schema。

## Phase 10：Fallback Graph

建立明確 fallback chain。工具不可用時要記錄原因並在 UI 說明，不可偷偷改用模型猜測資料。

## Phase 11：Research Executor

把 researchBundle 從計畫物件推進成真實執行管線：query → tool selection → source collection → normalize → dedupe → evidence → claim/source mapping → gaps/failures。只有真的取得外部 evidence 才能標 executed=true。

## Phase 12：Truth Classification

全站統一 FACT、USER_PROVIDED、SOURCE_VERIFIED、INFERENCE、SIMULATION、UNKNOWN。Audience Twin 必須標 SIMULATION，不得把模擬分數顯示成真實 CTR、轉換率或民調。

## Phase 13：Agent Registry 2.0

Agent profile 由 Runtime 真實能力產生，包含 role、model、capabilities、tools、mcpTools、skills、permissions、memoryScope、usage、status、currentTask；不要硬編碼固定五個 Agent。

## Phase 14：Parallel Execution

允許可控的 parallel groups，預設最大並行數 3，並保留硬上限，避免 runaway token / tool usage。

## Phase 15：Budget Planner

把既有 usage tracking 接到執行策略，提供 fast / balanced / deep 三種模式；UI 只顯示快速／標準／深入。

## Phase 16：Event Timeline

建立 task event timeline，涵蓋 plan、step、tool、agent、research source、fallback、confirmation、task completion/failure。只保存操作事件，不保存 chain-of-thought。

## Phase 17：Resume / Recovery

重新整理、關閉瀏覽器、網路中斷或服務重啟後，查回 local task 與 remote run，判斷 running/completed/failed/unknown。unknown 不得自動重送。

## Phase 18：Action Confirmation

統一所有高風險或有副作用操作的 prepare → confirm → execute 流程。Agent 可以準備操作，但不能自行完成確認。

## Phase 19：Zeabur Self-Operations

讓 Agent 可做 read-only 部署診斷；需要修改或重啟時先提出操作摘要並等待確認。操作結果不得直接等同應用已 healthy，必須再檢查 health / certification。

## Phase 20：Integration Control Center

保持現有 UI，收斂設定頁為 Hermes、Tamkang MCP、Zeabur、Canva、Memory、Research Sources、Social、Advanced。每張 card 顯示 status、capabilities、last verified、latency、test、settings。

## Phase 21：Mobile Task UX

維持 Chat First。新增 Task Status Pill + Bottom Sheet，顯示目前任務、steps、agents、tools、sources、elapsed time、stop；不要把 registry / usage 大表塞進手機主畫面。

## Phase 22：Turtle Runtime State

龜龜只由真實 runtime events 驅動：idle、planning、searching、using_tool、waiting_confirmation、working、success、error。禁止用假 timeout 模擬工作狀態。

## Phase 23：HermesConsole Incremental Refactor

逐步拆 `HermesConsole.tsx` 到 `components/console/`，每次 extraction 保持行為一致並先補測試，不做整體 UI rewrite。

## Phase 24：CSS 收斂

分批整理 tokens、console、mobile、settings、runtime，不引入大型 UI framework。

## Phase 25：Persistence Audit

建立 `docs/PERSISTENCE_AUDIT.md`，逐項記錄 SQLite、filesystem、process memory、Hermes remote、Zeabur、client memory 的 refresh/restart/redeploy/volume/multi-replica 行為。

## Phase 26：Multi Replica Readiness

建立 `docs/MULTI_REPLICA_READINESS.md`，先誠實標示目前支援拓撲與阻塞點，不急著全面改資料庫。

## Phase 27：Operator Security

維持目前 No Login 產品方向，不擅自改成會員系統。建立 `docs/OPERATOR_SECURITY.md`，清楚列出公開部署與設定操作的風險，必要時提供 optional operator lock。

## Phase 28：Rate / Abuse Protection

檢查 Chat、Tasks、Memory、Zeabur、Settings、Certification、Research、MCP 的 rate limit、body size、origin、validation、timeout，避免高成本操作被濫用。

## Phase 29：Test Expansion

新增 certification、orchestrator、context-engine、tool-router、fallback、research-executor、memory-verification、zeabur-operations、task-resume、action-confirmation 測試。

## Phase 30：Browser Journeys

Playwright 覆蓋正常長任務、Hermes unavailable、Tamkang fallback、Research sources、390px Task Sheet、refresh resume、Zeabur read-only test/list、Memory CRUD + MCP 同庫。

## Phase 31：Test Gate

每個主要 phase 至少跑 typecheck + unit/contract tests；重要 phase 加 production build + secret scan。最終完整跑現有 CI / browser test 套件。任何失敗不得宣告完成。

## Phase 32：Verification Labels

所有驗證結果只能標 LOCAL_UNIT、LOCAL_CONTRACT、LOCAL_BROWSER、LIVE_EXTERNAL、UNVERIFIED。Mock 外部服務不得寫成 Live Verified。

## Phase 33：PR #10 Capability Extraction

建立 `docs/PR10_CAPABILITY_EXTRACTION.md`，分類 Already Superseded、Already Implemented、Worth Porting、Unsafe/Fake、Obsolete、Conflict Risk。只抽能力，不直接 merge 舊架構。

## Phase 34：Documentation Cleanup

統一 README、DELIVERY、DEPLOYMENT、FEATURE_AUDIT 與新基準文件，能力狀態統一使用 Implemented、Locally Verified、Live Verified、Needs Authorization、Unsupported、Stub。

## Phase 35：Final User Journey

最終應支援：使用者只說「幫我做給淡江大一新生看的社團招生網宣，先研究最近議題、讀專案記憶、找靈感、模擬新生角度、提出三個方向，再整理成 Canva 可製作版本。」Console 自行完成 Goal → Project → Context → Memory → Runtime → Certification → Plan → Parallel Research → Tamkang → Inspiration → Audience → Creative Directions → Rank → Canva Handoff → Final Review → Sources。

## Phase 36：Final Delivery

建立 `docs/POST_PR20_COMPLETION.md`，至少包含 Current Architecture、Completed Phases、Changed Files、New APIs、New Modules、Certification Matrix、Hermes/Zeabur/Memory/MCP/Research/Canva/Security/Persistence Status、Tests、Live Verification、Remaining Blockers、Known Risks、Recommended Next PR。

## 長任務接續規則

建立並持續更新 `docs/LONG_TASK_PROGRESS.md`：Current Phase、Completed、In Progress、Blocked、Next Action、Tests、Important Decisions。若上下文或代理工作階段中斷，下一次先讀該文件再繼續，禁止從頭重做。
