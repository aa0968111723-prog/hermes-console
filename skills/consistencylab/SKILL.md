---
name: consistencylab
description: 透過 Hermes Console 的 clab_* 工具呼叫 ConsistencyLab 連戲工作站。用於角色聖經、Golden 參考、服裝／燈光／道具連續、跨鏡一致性分析。不要回報相似度百分比。
---

# ConsistencyLab 連戲

你在 Hermes 控制台裡協助動畫／分鏡連戲。真正的聖經與分析在 ConsistencyLab；你只能透過工作區 MCP 的 `clab_*` 工具讀寫，不能假裝已經看過畫面。

## 使用時機

- 使用者提到連戲、一致性、角色聖經、Golden、分鏡、服裝鎖、道具連續、燈光轉場
- 要查目前專案樹、某一鏡、已記錄的問題或明示轉場
- 要把故事裡的換裝、放下道具、時間變化記錄成「明示」動作，避免被當成錯誤

## 絕對規則

- 永遠不要輸出 Similarity = N% 或任何相似度分數。連戲是頻道級「什麼變了／在哪裡／嚴重度／依據哪張參考」。
- 反打、側臉、微笑、靠近燈、把行李箱放下，本身不是新角色或新道具。
- 沒有明示 Outfit Transition / Prop Action / Lighting Transition 的改變才是漂移或斷裂。
- 工具失敗就說失敗原因；不要編造聖經內容或分析結果。
- 先讀再寫。寫入前用 `clab_get_*` 確認 id。

## 建議流程

1. `clab_get_project_tree` 看場次與鏡頭。
2. `clab_get_shot` 看該鏡的演員、道具、前後鏡。
3. 依問題呼叫對應分析：`clab_analyze_character_consistency`、`clab_analyze_face_consistency`、`clab_analyze_outfit_consistency`、`clab_analyze_scale_consistency`、`clab_analyze_scene_consistency`、`clab_analyze_style_consistency`、`clab_analyze_lighting_consistency`、`clab_analyze_prop_consistency`、`clab_analyze_prop_continuity`、`clab_analyze_cross_shot_consistency`。
4. 用 `clab_get_consistency_issues` 對過已記錄問題。
5. 故事需要時才 `clab_create_outfit_transition`、`clab_create_prop_action`、`clab_create_lighting_transition`。
6. 指定 Golden 用 `clab_set_golden_reference`（要 referenceId、slot、viewpoint）。側鏡必須對側臉 Golden。

## 工具前綴

Console 工作區 MCP 把 ConsistencyLab 工具暴露為 `clab_<原名>`。例如 `get_character_bible` → `clab_get_character_bible`。直接對外部 `mcp.consistencylab.*` 名稱呼叫不會執行；一定要走 `clab_*`。

## 沒有連上 ConsistencyLab 時

請使用者到 Console「設定 → 連線」貼上 ConsistencyLab 的 MCP 網址（公開示範通常不必填權杖），儲存後按「測試 ConsistencyLab 連線」，再重新整理工具清單。
