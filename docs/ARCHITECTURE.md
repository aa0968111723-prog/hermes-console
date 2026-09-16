# Architecture

```
Human
  → Hermes Console（AuthGate → 視覺化工作區）
    → Hermes Agent
      → Planner / Reasoning
        → Memory
        → Tools
        → MCP Registry
          → External services
            → Artifacts / Results
```

Console 是使用者與 Hermes Agent Runtime 的主介面。它不是工具清單 App、MCP Dashboard、研究報告閱讀器，也不是 Canva／Notion／Figma／ChatGPT clone。

## 執行邊界

- 工具在 Hermes 執行。Console 保存專案、對話、任務、素材、記憶與活動。
- 前端只渲染結構化事件與高階進度，不顯示內部推理、toolCallId、endpoint、JSON schema（進階／Developer 除外）。
- 工作區資料列的 store owner 仍是單一 `workspace`。授權層是 User → Identity（Google／Tamkang／Email）→ WorkspaceMembership。

## 主要路徑

1. `/` → `AuthGate`。未登入顯示登入（未設定的 provider 誠實標示）。無 membership 不進工作區。
2. `HermesConsole`：對話為主。Planner 依意圖選工具，使用者不必先選 GALLEY／Canva／淡江。
3. `/api/chat`、`/api/tasks` 建立任務；狀態 `queued`／`running`／`waiting_user`／`waiting_authorization`／`stopping`／`completed`／`failed`／`cancelled`／`uncertain`。程序重啟時 monitor 立刻 reconcile：沒有 worker 的 chat 任務標 `uncertain`，不會假裝 still running。工具 HTTP 200 但內容為空不算成功。
4. Workspace MCP `/api/mcp` 給 Hermes 呼叫 Console 工具（含本地研究筆記搜尋）。外部 MCP 由 registry 探測，狀態不得假裝成功。
5. `GET /api/health` 是存活（不等待 Hermes）。`GET /api/ready` 是 store 就緒。`agentReady` 才表示 Agent 真的可用。

## 手機捲動

App shell 鎖定視窗；**唯一主捲動**在 `.conversation-scroll`（聊天）或 `.secondary-page`（其他頁）。底部 dock `position: fixed`。不要對捲動祖先做 transform，也不要用 `overflow-y: auto !important` 當修法。

`--app-height` 只在 Composer 軟鍵盤開啟時綁定 `visualViewport.height`。鍵盤關閉後必須回到 CSS `100dvh`，避免 Android Chrome 把殼層留在鍵盤縮小後的高度。

## 檔案

- UI：`components/HermesConsole.tsx`、`components/auth/`、`components/visual/`
- 授權：`lib/server/auth/`
- 編排：`lib/server/orchestrator/`、`lib/server/tasks.ts`
- MCP：`lib/server/mcp-registry.ts`、`lib/server/mcp.ts`
- 儲存：`lib/server/store.ts`
