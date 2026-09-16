# Hermes Console 架構

```
Human
  ↓
Hermes Console（AuthGate → Visual AI Agent Workspace）
  ↓
Hermes Agent
  ↓
Planner / Reasoning
  ↓
Memory（conversation / project / workspace / preference / runtime）
  ↓
Tools
  ↓
MCP Registry（Tamkang、GALLEY、訊核、Atlas、Lumen、FrameLab、Canva、Workspace、External）
  ↓
External Services
  ↓
Artifacts / Results
```

## Console 的角色

使用者與 Agent Runtime 互動的主介面。不是工具清單 App、不是 MCP Dashboard、不是 ChatGPT clone。

一般模式只顯示高階進度（理解／研究／創作／完成）。Developer／進階才看 endpoint、schema、latency、receipts。

## 身份與授權

```
User
 ├ Google Identity
 ├ Tamkang Identity
 └ Email Identity
      ↓
 Session
      ↓
 WorkspaceMembership (owner | admin | member)
      ↓
 Workspace APIs（固定 namespace `workspace`）
```

閘道 `X-Console-Gateway` 是部署邊界。工作區資料仍以 membership 為準。

## Runtime

- Hermes HTTP：models／capabilities／runs／chat／stop
- Console MCP 橋：`/api/mcp` + `MCP_BRIDGE_TOKEN`
- 背景 monitor 探索工具；離線來源會過期
- 任務狀態：queued、running、waiting_user、waiting_authorization、stopping、completed、failed、cancelled、uncertain
- 中斷的串流標 `uncertain`，不假裝遠端已停止

## 資料

Store kinds 包含 user、identity、membership、session、conversation、message、task、material、artifact／creative revision、memory、mcp_registry、confirmation。SQLite 或 Postgres `console_records`。

## 前端

- `AuthGate`：未登入不載入工作區
- `HermesConsole`：對話捲動區是 chat 的唯一主捲動；其他頁用 `.secondary-page`
- 手機 Bottom Dock：對話／專案／靈感／Agent；設定在頂欄
- 龜龜把 Agent 狀態視覺化，不是裝飾；點進去看進度與記憶，標題是 Hermes，不是工程「空間」
