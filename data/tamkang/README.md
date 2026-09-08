# 淡江大學社團全生態知識庫

此目錄是 Hermes Console 的淡江社團生態**版本化資料庫**。

- 本機試算表仍只有一本：`淡江大學社團全生態知識庫.xlsx`
- 每一輪研究必須 upsert 進同一本 xlsx，**並匯入本目錄**
- Console 執行期 SQLite（`.data/console.sqlite`）不進 Git（見根目錄 `.gitignore`）
- 本目錄的 JSON 才是可提交、可回溯的資料庫快照
- 匯入指令會把快照寫進 `records(kind, owner, id, value)`，`owner=workspace`

## 規則

1. 單一活檔：禁止再開 Cycle002.xlsx
2. 雙層驗證：每筆必有 L1 來源等級 + L2 驗證層
3. 存在性事實 ≠ 生態性事實
4. 173 / 178 / 184 社團數＝矛盾待裁，三數並陳
5. 禁止社員姓名、學號、電話、信箱；禁止禅學社 Drive 名冊當第二源

## 匯入 SQLite

在 repo 根目錄：

```bash
node scripts/import-tamkang-kb.mjs
```

預設讀 `data/tamkang/records.seed.json`，寫入 `$CONSOLE_DATA_DIR/console.sqlite`（未設則 `.data/console.sqlite`）。

本腳本必須在 **Console 主機**執行。GitHub 只收 JSON 快照；不要 commit sqlite、不要改 Console 應用程式碼、不要部署、不要寫入金鑰。

每小時研究循環（Automations task `9937e72c-f973-4d72-955f-672c2d1c741f`）會 upsert 本目錄三檔。

## kind 對照

| kind | 來源表 |
|---|---|
| tku_club | 01_社團總表 |
| tku_activity | 02_活動資料庫 |
| tku_fair | 03_社博情報 |
| tku_need | 04_學生需求 |
| tku_relation | 05_社團關係 |
| tku_coop | 06_合作機會 |
| tku_compete | 07_競爭與受眾重疊 |
| tku_health | 08_社團健康度 |
| tku_promo | 09_宣傳案例 |
| tku_trend | 10_趨勢雷達 |
| tku_signal | 11_弱訊號 |
| tku_gap | 12_生態缺口 |
| tku_peer | 13_外校案例 |
| tku_source | 14_來源資料庫 |
| tku_unverified | 15_待驗證資料 |
| tku_question | 16_研究問題 |
| tku_log | 17_每小時研究紀錄 |
| tku_kb_meta | 主檔中繼資料 |

更新時間：2026-09-08 11:20 CST
