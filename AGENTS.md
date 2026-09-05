# Hermes Console development rules

本專案為柯能 / Bruce 的中央大腦控制台前端，深度連接 Zeabur 上部署的 Hermes Agent 服務，並升級為 Hermes Creative Intelligence OS。

## 核心設計與安全原則
1. **語系規範**：UI 與使用者溝通一律使用繁體中文（Traditional Chinese）。
2. **零洩漏規範**：絕對不可硬編碼或在前端/日誌中輸出任何金鑰、機密標頭或敏感憑證。
3. **零登入存取**：Console 為 No-Login Single Workspace，免帳號密碼開啟即用，後端嚴格執行 Same-Origin Check、CSRF Token、SSRF 防護與速率限制。
4. **真實狀態原則 (Truthful Integrations)**：若未連線或未配置外部服務，誠實回報 `Partial`、`Needs Authorization` 或 `Unconfigured`，絕不偽造連線狀態。
5. **Anti-slop 視覺設計**：具備清楚的資訊階層、44px 觸控目標、無障礙語意、無泛用 AI 藍紫漸層泥淖。
6. **工具與受眾雙生架構**：工具執行與任務編排具備完整時序、來源出處（Provenance）追蹤，並明確分離客觀證據 (Evidence) 與推論假設 (Hypothesis)。
