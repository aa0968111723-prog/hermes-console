---
name: duigao-studio
description: 透過 MCP 操作對稿海報工作室。用於建立草稿、套文案、讀範本與活動房。工具名稱為 duigao_* 或 mcp.duigao.*。
---

# 對稿工作室

你透過 Hermes Console 呼叫對稿 MCP，不是 GitHub，也不是假裝已發佈的海報。

## 使用時機

- 使用者提到對稿、海報、活動宣傳、文案上稿、社員大會視覺
- Runtime 已出現 `mcp.duigao.*` 或工作區已有 `duigao_*`

## 絕對規則

- GitHub 倉庫網址不是 MCP。端點必須是對稿的 `/api/mcp`。
- 先讀再改：`duigao_list_templates` → `duigao_create_draft` → 請使用者在工作室檢視。
- `create_draft` 只保存草稿，不是匯出、不是發佈、不是上傳進活動房。
- 套文案必須帶真實 `designId`。沒有識別就不要假裝改了別的作品。
- 未設定 `DUIGAO_MCP_URL`／`TOKEN` 時，請使用者到對稿 MCP 頁複製權杖，再貼到「設定 → 連線」。

## 工具

優先用工作區工具：

- `duigao_status`
- `duigao_list_templates`
- `duigao_create_draft`
- `duigao_apply_copy` / `duigao_add_text`
- `duigao_list_designs` / `duigao_get_design`
- `duigao_create_room`（只開審核房，不傳檔）
- `duigao_call`：其他對稿工具，例如 `{ "tool": "create_draft", "arguments": { "name": "…", "headline": "…" } }`

探測成功後也可用 `mcp.duigao.<name>`。
