# Hermes Console 正式產品化盤點

基準：`cursor/hermes-production-finalization-cf7e`（接續 `origin/main`）。這不是新 App，也不是第二套 Dashboard。狀態以程式與測試為準，不以文件宣稱為準。

## 總覽

| 區域 | 判斷 | 說明 |
| --- | --- | --- |
| AuthGate / User / Identity | 可選／dormant | 預設免登入。session 讀取失敗仍進入工作區。`CONSOLE_AUTH_REQUIRED=true` 才開 Google／Email／淡江閘。InvitationGate 不得擋 `/` |
| 手機捲動 | 部分可用 | App shell 鎖定；主捲動在 `.conversation-scroll`／`.secondary-page`；dock `fixed`。契約測試有 nested scrollport，非正式真機 |
| Runtime Inspector | 部分可用 | 一般檢視只顯示 Hermes／記憶／工具／MCP。開發者檢視才露出 schema 與工具清單 |
| MCP Registry | 部分可用 | GET 不回 endpoint／憑證名／schema。未探測的已設定 MCP 是 `awaiting_authorization`，不是 partial。tools/list 成功才是 partial；缺 token 是 unconfigured |
| Artifacts / 版本 | 部分可用 | `artifactId`／`revisionId`、還原、fork、並排預覽（不是像素 diff）。Canva poll 成功會寫入 |
| Memory 分層 | 部分可用 | `listMemories` 依 scope 精確過濾；`memoriesForProject` 才把工作區偏好併入專案脈絡並保留 scope 標籤 |
| 設定頁 | 部分可用 | 帳號／外觀／連線／工作區／進階 |
| CI | 部分可用 | lint／typecheck／unit／Playwright／build／secrets |
| 部署 | Partial | 文件齊；本輪不執行公開 Zeabur 佈署 |

## 完全可用（契約層）

- Origin 驗證、rate limit、確認 token、工具權限分級
- SQLite／Postgres 雙後端
- `/api/ready`、`GET /api/health` 不回秘密
- SSRF 守衛
- 龜龜狀態（含 offline／planning／creating）

## 部分可用

- 正式 Auth：Google／Email 需部署端密鑰；淡江 SSO 缺校方 metadata。帳號頁可列出／結束其他工作階段；目前這個瀏覽器只能登出
- MCP 真實探測需各服務 URL／TOKEN
- Artifact 比較是並排預覽，不是像素 diff；PDF／連結沒有偽造封面
- Inspiration／Audience Twin／研究 Markdown 檢索。靈感已接到 `workspace_search_inspiration`：分群＋三個方向，不假裝 IG 全站搜尋

## 危險／誠實限制

- 公開部署若無閘道或 Auth 密鑰，行為必須 fail closed
- Tamkang MCP 權杖 ≠ 淡江 SSO
- 曾暴露金鑰一律視為 compromised
- 本輪沒有 live Zeabur／校方 IdP／Google 實機登入證據

## 本次已修

1. 手機捲動所有權（前一輪）
2. 統一 AuthGate（前一輪）
3. MCP 誠實狀態 + 公開 registry 消毒
4. Artifact 版本／還原／fork
5. Memory scope 隔離
6. Runtime／任務 JSON 收到開發者檢視
7. 設定頁收斂
8. Android 鍵盤：`--app-height` 只在鍵盤開啟時跟隨 visualViewport，關閉後回到 `100dvh`
9. 連線格：Hermes／Workspace／Atlas／Zeabur 不再把「已填密鑰」顯示成已連線
10. 首頁快捷：手機與桌面同一組六個短標籤（研究／創作／分析／客群／靈感／設計）
11. 帳號工作階段清單與結束其他裝置（目前瀏覽器走登出）
12. 作品並排預覽比較；圖片素材縮圖 WebP 320
13. 手機 Bottom Dock 為主導覽；漢堡改為對話列表
14. 閒置輪詢 8s、執行中 3s；`*_unconfigured` 歸 TOOL_UNAVAILABLE（auth_unconfigured 仍是 AUTH_ERROR）
15. `GET /api/health` 存活不等待 Hermes；`agentReady` 與 store ready 分開
16. Hermes 可搜尋本地 `data/ai-agent-research` 筆記（標明 local_notes，不是即時論文庫）
17. 工具空結果（`{}`／空白字串）記為 `empty_tool_result`，不得當完成；啟動 monitor 立刻 reconcile 中斷任務為 `uncertain`
18. 設定頁不再收集淡江學校密碼；連線密鑰變更限 owner／admin；附圖／「這張哪裡可以改」走讀圖 + 受眾模擬
19. 已登入帳號可連結 Email；Google → 淡江 → Email 後用淡江回來仍是同一 User。淡江 OIDC 以本機 mock IdP 契約測試（discovery + PKCE）；SAML／CAS 誠實未設定
20. 忘記密碼信件的 `/#reset=` 會打開重設密碼表單，不會把 token 當成登入／驗證一次用掉
21. 未設 `HERMES_IMAGE_INPUT=true` 時，附圖顯示「尚未驗證讀圖」。一般附圖送 Hermes 仍拒絕；「這張哪裡可以改」走工作區模擬，明確標沒有讀像素。Runtime 開發者檢視的讀圖狀態跟 env 走，不是 unknown
22. Planner 不再指向不存在的 `project_inspiration_then_web`／`creative_directions`／`audience_simulation`。找靈感走 `workspace_search_inspiration`（已收藏分群＋三個方向）；受眾走 `workspace_simulate_audience`；方向保存走 `workspace_save_directions`。`淡大` 視為淡江。對話與靈感板顯示方向卡，不丟連結清單或 JSON
23. 方向卡可點選：寫入既有 workflow、`chooseDirection`，並自動送出「我選方向 A/B/C」接續整理文案。`workspace_project_context` 帶出已選定方向，不必叫使用者貼流程 ID
24. 選定方向後 `directionLocked`：不再找靈感、不再 `workspace_save_directions`；計畫改為專案上下文 → 視覺規格 → 文案 → Canva 規格。即使跟進句含「文案／視覺／淡大」也不重跑靈感搜尋。token 裁切後仍保留鎖定指示，不會退回「再找靈感」
25. 選定方向後立刻編譯可見的文案 A／B／C 與 4:5／9:16／A4 規格卡（規則草稿）。不是 Hermes 生成、不是已出圖。Hermes 未連線時仍可看到規格，並誠實提示尚未連線
26. 選定方向會寫入候選活動（無捏造日期地點）與可改版文案 `copyId`。同一方向的後續修改沿用同一文案 id；專案脈絡帶出 `activityId`／`copyId`
27. Hermes 未設定時，對話「找靈感」仍走工作區 `workspace_search_inspiration`，顯示方向卡。 provenance=`workspace`，不寫 Agent verified，不假裝已搜 Instagram／已連淡江／已出圖。非靈感對話仍回 `hermes_not_ready`
28. 對話選方向 A/B/C 後，同一捲動區顯示文案／規格草稿（未出圖）。一般訊息不顯示「N/N 個工具完成」；執行紀錄改為圖示，accessible name 仍保留
29. 上傳海報問「這張哪裡可以改」：未驗證讀圖時仍可送出。回傳畫面審查清單＋新生模擬，provenance=`workspace`，`pixelRead=false`，不寫 Agent verified，不假裝已看像素。沒有附件則 `invalid_input`，不走靈感假路徑
30. 學生可見文案把日期地點寫成「未確認」，資料模型仍用 `UNKNOWN`。已選方向的 4:5／9:16／A4 規格框加大
31. 選定方向的規格草稿綁在選方向的那則對話。新對話首頁只留龜龜與「今天想做什麼？」，不把上一則規格或「規格已整理」橫幅貼上去。靈感板仍顯示專案最新規格
32. 規格框直接放進 A/B/C 文案（未出圖）。手機單欄壓低框高，避免 9:16 整屏空白；≥640px 才用比例框。選方向後把規格捲到可見，不跳去底部說明。跳至輸入區未聚焦時不佔畫面。客群十人細節預設折疊，只先顯示較會停／較會滑掉
33. 找靈感回覆以方向卡為主畫面。有結構化卡片時不重複貼長段誠實說明。空 cluster 不顯示。送出後把方向卡釘在可視區
34. 工作區已把結果畫在對話裡時，composer 不再掛「完成」列，避免蓋住方向卡與規格框。Hermes／測試 fixture 的完成任務列仍保留以便打開詳情
35. 360px 方向卡改水平 snap rail：A 可見、B 露出、橫滑可到 C。對話主捲動仍是 `.conversation-scroll`；rail 另開 `pan-x`。方向卡／審查／規格在可視區時不顯示「回到最新訊息」。畫面審查不再重複貼與 checklist 相同的說明段落
36. 選定方向會寫入 source=`workspace` 的作品版本（V1／V2），任務頁顯示規格草稿預覽。不是 Canva 設計、不是已出圖、不是 Hermes 生成。同一方向重複選不會另開作品
37. Hermes 未連線時，「第二版字放大」修同一件規格（主標加大、V2），不 503、不出假圖。任務頁有規格草稿時不再重複貼舊的文字方向清單
38. 靈感頁第一屏是方向卡。招生說明／漏斗／社團視覺語言在卡片之後；Drive 知識預設摺疊。任務頁「接續修改」寫「請接續修改同一作品」，不再把 workflow UUID 塞進輸入框。次頁 `.secondary-page` 以 `key={nav}` 重掛，切換靈感／專案／任務時不會沿用上一頁捲動位置
39. 任務頁「接續修改」會回到擁有該規格的對話，不是空的「今天想做什麼？」。送出「請接續修改同一作品」走工作區接續：同一件 V1，不 503、不另開版本。沒有已選方向的對話仍是 `hermes_not_ready`
40. 「回到最新訊息」看所有可見的方向卡／審查／規格，不是只看 DOM 裡第一個靈感卡。接續後規格在畫面裡時不蓋住 A4 文案
41. 專案「活動與文案」接續不再把 `workspace_*` 或活動／文案 id 塞進輸入框。有綁定對話時跳回該對話，與任務頁接續同一件作品
42. Hermes 未連線時，工作臺「寫 A／B／C」「整理三個方向」與 Composer／Dock 的 Canva 查回改為停用並標「尚未連線」，不把學生送進 503。規格框只顯示語氣與「海報 A4」，不再露出紙張比例 `210:297`。同一作品接續仍可用
43. Agent 分頁給學生看 Hermes／記憶／工具／MCP 狀態點，不在一般檢視顯示 0/300 工具數或 Agent OS 設定檔。任務頁選方向只保存選擇；沒有綁定對話且 Hermes 未連線時不把「缺授權／阻塞點」塞進輸入框。首頁快捷不再寫 Canva 授權失敗稿
44. `/` 免登入：session 讀取失敗不再停在「無法確認登入狀態」。畫面審查從 `image_review.twinPanel` 畫出「新生第一眼模擬」。未支援 Web Speech 時不顯示語音鈕；支援時為 44px、zh-TW、不打斷 IME
45. Hermes 未準備好時學生文案改為「可以先找靈感」，不再指向連線設定。頂欄連線點改開「能力」頁。首頁能力軌道與一般檢視不列出工具名稱；網址／權杖表單收在「填寫網址與權杖」
46. 能力頁預設沒有開發者檢視；需在設定 → 進階勾選「顯示維運檢視」才出現工具清單與 schema。任務詳情的 UUID／原始 JSON 收在摺疊「維運檢視」。語音說完後提示「說完了，請按送出」，不自動送出
47. `Permissions-Policy` 允許同源麥克風（`microphone=(self)`）。Web Speech 被拒時顯示「無法使用麥克風」，不靜默失敗。說完後的「說完了，請按送出」改為可見提示
48. 對話中的查回失敗與任務結束錯誤走學生文案，不再寫金鑰、部署、服務日誌、原始會話或請至 Hermes
49. 進行中任務按鈕與事件列只顯示「研究 · 執行中」這類階段，Hermes preview／工具原文收在維運檢視
50. 任務詳情「接下來」只顯示階段；執行計畫原文、UNKNOWN 與完整來源網址收在維運檢視。Esc／點背景關閉會清掉維運檢視
51. 未驗證讀圖的附圖送出改為「還沒辦法讀圖」，不再寫部署端。不確定結果改「再試一次」，不再寫重試分支或遠端已停止
52. Hermes 未設定時，口語「我想辦茶會」走工作區靈感方向卡；「幫我查淡大禪學社茶會」「今天社博在哪」走社團 Drive 索引快照，不是海報工廠，也不是 503。仍標明不是 Hermes、沒有 IG 全站搜尋、沒有連到淡江資料源。純「幫我查論文」、招呼、未選方向的接續仍是 `hermes_not_ready`
53. 學生畫面不再露出 UNKNOWN、像素尺寸或 `live=false`：視覺卡寫「貼文／未提供」，社團索引寫「尚未確認／不是即時」。口語查茶會的 Playwright 會等到社團資料卡；靈感頁證據標改為中文，不再寫 FACT／UNKNOWN
54. 口語「我想辦迎新」／「我想辦活動」／攤位／場佈／「我想擺攤」走工作區靈感；「淡江迎新在哪」「茶會幾點」「擺攤在哪」這類事實問句（在哪／幾點／什麼時候）先當 lookup，走 Drive 索引而不是海報工廠。不必先說淡江或幫我查。「這張哪裡可以改？」仍是創作審查，不用裸「哪裡」當事實問句
55. 同一對話先查社團資料再畫面審查時，捲動釘在最新一張結果卡（畫面審查），不會停在上面的索引卡外畫面。新生模擬卡在審查下方，不搶釘選
56. Hermes 未設定時，首頁「客群」與口語「路人會不會滑掉」走工作區新生第一眼模擬，不是 503，也不是已看圖。學生畫面寫「模擬」，不寫 SIMULATION
57. 首頁「分析」或「這張哪裡可以改」沒附圖時仍回畫面審查＋新生模擬，明確標沒有附圖、沒有讀像素，不 400、不假裝已看圖。學生卡寫「還沒讀圖」
58. 語音連續辨識：停頓不會結束這一輪。說完（學生按停止）才出現「說完了，請按送出」。沒聽到時寫「沒聽到語音。請靠近再試一次。」不自動送出
59. Android Chrome 在思考停頓後仍可能送 no-speech 並結束辨識。已聽到內容時會自動再開始聽，直到學生按停止；空白的 no-speech 才提示靠近再試
60. 語音填入時不搶 textarea 焦點，避免手機鍵盤在說話途中彈出擋住送出。說完按送出後，口語「我想辦茶會 再幫我看場佈」走工作區靈感方向卡，不是 503、不露出 HERMES_ / MCP_
61. 靈感卡眉標改為「沒有已收藏來源／工作區收藏 · 未搜全站」，不再寫「0 筆已收藏」或信心「低／中」。口語送出後可按「用這個」拿到已選方向規格（不是已出圖）
62. 同一對話接著口說「今天社博在哪」並送出，走社團 Drive 索引卡（已核對或尚未確認／不是即時），釘在最新社團資料，不是再出一輪海報工廠
63. 選定規格後的社團資料／畫面審查優先釘在可視區，不會被對話尾端的規格草稿蓋掉；還沒有後續結果時仍釘規格框
