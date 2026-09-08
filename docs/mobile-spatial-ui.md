# Mobile spatial workspace

本分支只處理手機優先的呈現與互動，保留既有 Console、Hermes、MCP、任務、記憶與專案資料流。所有 UI 狀態仍來自 API 或實際任務事件；沒有加入本地假進度、假連線或第二套記憶。

## UI audit

Before：首頁與側欄同時顯示長說明、技術狀態及多個文字 CTA；工具結果以長 Markdown 為主；附件、專案及成果缺少手機優先的可視分層。

After：

- 首頁以真實 Hermes Core 為視覺焦點；手機只保留四個 2×2 快捷動作。
- 底部 dock 提供對話、靈感、專案、任務與中央 Hermes 快捷選單；次要能力放進可關閉 bottom sheet。
- 快捷選單的圖片／文件會走既有真實上傳流程，Canva／記憶／能力會進入既有入口。
- 空間面板顯示最多五個實際能力節點與目前專案／工作區範圍內的真實記憶；服務失敗時顯示可重試錯誤。
- 附件、專案封面與作品採橫向縮圖列；作品可開啟原始預覽並回到同一個可修改流程。
- 技術名稱、schema 與 runtime log 維持在既有進階檢視，不塞入主要操作路徑。

## Depth and motion

`app/mobile-spatial.css` 使用 canvas、surface、card、active、overlay 層級 token，並以 CSS transform、SVG beam、陰影與邊緣高光呈現空間感。手機預設使用 reduced spatial mode；`prefers-reduced-motion`、使用者關閉動畫、背景分頁及 static fallback 會停用非必要動畫。沒有導入 WebGL 或感測器權限。

## Verification

`npm run lint`, `npm run typecheck`, `npm test`（254 tests，252 passed，2 skipped）與 `npm run build` 均通過。

`npm run test:ui` 使用 production server 與隔離資料目錄，通過 axe（所有檢查畫面 0 violations）、IME/Shift+Enter、附件預覽、記憶範圍、任務狀態、離線狀態與 360/390/430/768/1024/1440 layout；LCP 212ms、CLS 0.00008 為本機 Chrome 測量。

`tests/mobile-engines.ts` 以觸控模式 Chrome 與 Playwright WebKit 驗證 360×800、375×812、390×844、393×852、412×915、430×932，均無水平溢位、dock/composer 遮擋或觸控尺寸不足。WebKit 模擬不等同實體 iPhone Safari；本次沒有宣稱真機驗證。

外部 Zeabur、Canva、Instagram、Pinterest 與淡江服務沒有在本地測試中冒充已連線；真實授權／端點仍依部署環境顯示實際狀態。

截圖與 JSON report 由測試產生於 `output/playwright/`（該目錄依 `.gitignore` 不提交）。
