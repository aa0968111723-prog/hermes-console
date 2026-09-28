# TKU AI CLI

淡江大學領袖禪學社與淡江大學禪學社的本機終端入口。
它只包一層官方 `hermes`，不另建大腦，不在瀏覽器 Console 開 PTY。

## 啟動

先安裝 [Hermes Agent](https://github.com/NousResearch/hermes-agent)，確認 `hermes` 在 PATH。

```sh
# 可選：把封裝加進 PATH
chmod +x runtime/tku-ai/bin/tku-ai
export PATH="$PWD/runtime/tku-ai/bin:$PATH"

tku-ai setup     # 複製禪學社技能、設 xai-oauth、寫 API server 金鑰（不印出）
tku-ai auth      # hermes auth add xai-oauth --no-browser
tku-ai doctor    # 檢查；金鑰只顯示末四碼
tku-ai           # TTY 時開 hermes --tui
tku-ai gateway   # 啟動 Hermes gateway / API server
```

金鑰只留在 `$HERMES_HOME/.env`（預設 `~/.hermes/.env`）。
Console 的 `HERMES_API_KEY` 必須與 `API_SERVER_KEY` 相同；`HERMES_API_URL` 指向該 API server，不要多餘路徑。

## 不做的事

- 不實作第二個 agent 迴圈
- 不把金鑰、`.env` 寫進 Git
- 不在免登入工作區放真正 shell
- 不代替 `docs/TKU_AI.md` 的 LIVE 驗證
