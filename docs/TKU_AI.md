# TKU AI

TKU AI 是這個倉庫的產品名。執行層只有 Hermes Agent，不另建模板大腦。
`tku-zen-agent` 的事實規則收在這裡，不再維持第二套編排器。

## 它是什麼

- 介面：Hermes Console（免登入單一工作區）
- 代理：Hermes。工具在 Hermes 執行，畫面只渲染結構化事件
- 模型：xAI Grok OAuth（`provider: xai-oauth`）。用 SuperGrok 或 X Premium+ 額度，不靠 `XAI_API_KEY`
- 知識：`data/zenclub/` 快照。缺欄位標 UNKNOWN，衝突並陳。兩個社團名稱都保留

## xAI Grok OAuth

在 Hermes 主機上，不要把令牌寫進 Git：

```
hermes config set model.provider xai-oauth
hermes config set model.default grok-4.6
hermes config set model.base_url https://api.x.ai/v1
hermes auth add xai-oauth --no-browser
```

瀏覽器打開印出的網址並核准。之後 Hermes 會自己刷新。
登入成功但推論回 HTTP 403 時，才改走 `provider: xai` 與 `XAI_API_KEY`。

API server 給 Console 用。秘密只放 `HERMES_HOME/.env`：

```
API_SERVER_ENABLED=true
API_SERVER_HOST=0.0.0.0
API_SERVER_PORT=8642
API_SERVER_KEY=<openssl rand -hex 32>
```

Console 的 `HERMES_API_URL` 指向該位址（不要帶多餘路徑），`HERMES_API_KEY` 與 `API_SERVER_KEY` 相同，`HERMES_MODEL=hermes-agent`。

## 安裝設定檔

```
sh runtime/tku-ai/scripts/install-profile.sh
```

腳本會複製禪學社技能、設定 `xai-oauth`，並在缺少時產生 API server 金鑰。金鑰不會印出來。

## 不做的事

- 不把 `tku-zen-agent` 的 Python 編排器再塞進 Console 當第二個大腦
- 不把通訊錄、電話、學號、生日抄進回答或這個文件
- 不把歷年檔案的人名與金額當成今年事實
