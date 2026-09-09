# 淡江禪學社 Drive 知識層

此目錄是 Hermes Console 的禪學社 **內部事實快照**，來源為社團 Google Drive：

https://drive.google.com/drive/folders/1H-GuCfVw51D5_ipAoivjboabhb7iaKt6

與 `data/tamkang/`（淡江全校社團生態）分開。本層只處理禪學社 Drive。

## 規則

1. Drive 原檔只讀；禁止自動刪除、覆蓋或改寫使用者 Drive。
2. 通訊錄、報名回覆、電話、學號不進可搜尋內容（`piiRestricted`）。
3. 缺資料標 `UNKNOWN`，不得用 IG 或「看起來合理」補上。
4. 同一欄位多個值並陳，標 `CONFLICTING`。
5. 索引是快照，不是即時 MCP。`live=false`。

## 檔案

| 檔 | 用途 |
| --- | --- |
| `catalog.json` | Drive 區域與文件索引 |
| `graph.json` | 活動／講師／場地 claims、衝突、邊 |

執行期由 `lib/server/zenclub` 讀取。API：`GET/POST /api/knowledge`。

更新時間：2026-09-09（Grok 01 Drive Knowledge 首輪）
