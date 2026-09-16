# Architecture

Hermes Console 是 Hermes Agent 的視覺化工作空間，不是獨立 Dashboard 或第二個 App。

```
Human
  → Hermes Console（AuthGate · Visual workspace）
    → Hermes Agent
      → Planner / Reasoning
      → Memory（conversation / project / workspace / preference / system）
      → Tools
      → MCP Registry
        → Tamkang / GALLEY / 訊核 / Atlas / Lumen / FrameLab / Canva / Workspace / External
      → Artifacts / Results
```

## Console

- Next.js App Router。`/` → `AuthProvider` → `AuthGate` → `LoginScreen` 或 `HermesConsole`。
- 正式環境 `CONSOLE_AUTH_MODE=required`（`NODE_ENV=production` 預設）。契約測試可用 `workspace` 單一 owner。
- 前端只渲染結構化事件與結果。不展示內部推理、tool JSON、credentialReference。
- 手機：App Shell 鎖文件捲動；Chat 的唯一主捲動是 `.conversation-scroll`；其他頁用 `.secondary-page`／`.page-scroll`。鍵盤開啟時用 `visualViewport` 寫 `--app-height`，關閉時移除，避免殼層永久縮短。

## Agent runtime

- 任務狀態：`queued`／`running`／`waiting_user`／`waiting_authorization`／`stopping`／`completed`／`failed`／`cancelled`／`uncertain`。
- 取消會打後端 stop，不是只藏 UI。
- 長任務中斷標 `uncertain`，不假裝仍在跑。
- Runtime Inspector：一般只看 Hermes／Memory／Tools／MCP 狀態；Developer 才看工具清單、schema、latency。

## MCP

- 後端 Registry 探測 Streamable HTTP。
- `interpretVerification`：initialize 失敗 → failed；有連線無 tools/list → connected；有清單無安全讀取 → partial；安全讀取成功 → verified。
- 沒有端點或權杖 → unconfigured。探測中 → verifying。
- 禁止把一次成功任務當成整個 Hermes `available`。

## Data

- SQLite（`CONSOLE_DATA_DIR`）或 Postgres（`DATABASE_URL`，僅 `console_*` 表）。
- 作品：`artifactId` + `revisionId`（restore／fork）。
- 記憶列有 `source`／`createdAt`／`updatedAt`／`scope`／`confidence`。專案 digest 可附加 workspace 列，但標明 scope，不把兩層混成同一列。

## AuthZ

登入 ≠ 進私人 Workspace。API 驗證 session + membership。憑證寫入限 owner／admin。Secret 只在 server。
