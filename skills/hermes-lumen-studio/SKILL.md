---
name: hermes-lumen-studio
description: 經 Hermes Console 的 Workspace MCP 呼叫 Lumen 創作台。用於開案、三個方向、研究卡、畫板與 Style DNA。工具名 lumen_utter／lumen_save_directions。
---

# Lumen 創作台

Lumen 是獨立的 Streamable HTTP MCP。接線方式與訊核相同：設定 `LUMEN_MCP_URL` 後，Workspace MCP 立刻出現 `lumen_*`，Hermes 不必另開第二條 MCP 連線。

## 何時使用

- Runtime 已出現 `lumen_utter` 或 `mcp.lumen.lumen_utter`
- 使用者要用口語開案、看畫板、保存方向

## 怎麼呼叫

- 先 `lumen_get_session` 或 `lumen_health`，確認創作台可達。
- 口語一律 `lumen_utter`。不要叫使用者填 prompt 表單。
- 你整理好的三到五個方向用 `lumen_save_directions` 放到畫板，**等待使用者在 Lumen 或 Console 選定**。不要呼叫不存在的 `choose_direction`。
- 每次呼叫帶目前 Console `taskId`。
- 校色或校徽未核到就標未確認，不要自行補完。

## 工具

- `lumen_health`：探測
- `lumen_utter`：開案／改畫板
- `lumen_get_session`：讀專案
- `lumen_list_board`：讀可見卡片
- `lumen_get_research`：讀研究卡
- `lumen_save_directions`：保存 3–5 個方向
- `lumen_lock_style`：鎖定目前 Style DNA
- `lumen_list_receipts`：看是否真的打進 Lumen

Runtime 清單上的名稱是 `mcp.lumen.lumen_utter`；Workspace MCP 上的名稱是 `lumen_utter`。兩個都指向同一創作台。

## 還沒接上時

不要假裝已開畫板。請使用者到 Console 設定 → 連線填 `LUMEN_MCP_URL` 與 `LUMEN_MCP_TOKEN`，按「測試 Lumen 連線」。
