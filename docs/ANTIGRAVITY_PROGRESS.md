# Hermes Creative Intelligence OS - 實作進度追蹤紀錄

本專案遵循「Long-Running Autonomous Engineering Loop」，將 `hermes-console` 升級為支援零登入、淡江大學禪學社場景深度適配、Audience Twin 受眾雙生模擬、靈感引擎、Canva 自動草稿與安全社群發布的 **Hermes Creative Intelligence OS**。

---

## 階段進度總覽

| 階段 | 模組名稱 | 狀態 | 核心成果與驗證 |
| :--- | :--- | :---: | :--- |
| **Phase 0** | 基準建置與洩漏金鑰淨化 | 已完成 | 清理程式碼庫所有歷史洩漏金鑰；建立 `feat/hermes-creative-intelligence-loop` 分支；初始化追蹤日誌。 |
| **Phase 1** | 零登入單一工作區重構 | 已完成 | 零登入直接使用；CSRF Token、同源防護、SSRF 檢查、速率限制；Canva PKCE 獨立狀態 Cookie 支援；單元測試 100% 通過。 |
| **Phase 2** | Hermes Multi-Profile 註冊體系 | 進行中 | 支援 `general`, `creative`, `tku`, `research`, `design`, `social`, `reviewer`；自動端點探測與備援。 |
| **Phase 3** | 大腦記憶中心與用量追蹤 | 待開始 | 用量事件記錄；專案與會話隔離記憶檢索。 |
| **Phase 4** | 遠端 MCP 註冊表與淡江 Adapter | 待開始 | 5 級工具權限；Tamkang MCP 適配器（淡江校園時程、大一新生作息、社團場地）與降級調研。 |
| **Phase 5** | 萬象靈感引擎 (Inspiration) | 待開始 | 整合公開研究、IG/Pinterest 靈感語意分析、素材解析與版權標註。 |
| **Phase 6** | Audience Twin 受眾雙生模擬 | 待開始 | 大一新生上下文圖譜；5 大 Persona 模擬與辯論；受眾評分指標；證據/假設分流標籤。 |
| **Phase 7** | 創意工作流 2.0 & Canva 草稿 | 待開始 | 3~5 個創意策略方向；Canva 設計草稿產出；受眾再測驗；社群 IG 貼文排版。 |
| **Phase 8** | 安全社群發布審核機制 | 待開始 | 敏感/破壞性操作單次 Token 綁定與防重複發布冪等鍵。 |
| **驗證** | 端對端測試與 PR 提交 | 待開始 | Next.js Build 驗證、自動化測試、建立 Pull Request。 |

---

## 關鍵資安規範
1. **絕不硬編碼真實金鑰**：歷史洩漏金鑰視同廢止，所有範本一律使用 `<HERMES_API_KEY>` 佔位符。
2. **零登入存取安全性**：無需登入即可使用創作工作區，但後端寫入與敏感發布操作均具備同源檢驗、單次 Token 與速率限制防護。
3. **無造假原則**：若遠端服務尚未綁定或未連線，系統誠實回報 `未配置` 或 `本地備援中`，絕不偽造連線成功狀態。
