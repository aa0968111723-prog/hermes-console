import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("login is turtle-first with honest unconfigured providers", async () => {
  const screen = await readFile(
    new URL("../components/auth/LoginScreen.tsx", import.meta.url),
    "utf8",
  );
  const gate = await readFile(
    new URL("../components/auth/AuthGate.tsx", import.meta.url),
    "utf8",
  );
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(screen, /LoginMascot/);
  assert.match(screen, /login-stage/);
  assert.match(screen, /淡江 SSO 尚未完成設定/);
  assert.match(screen, /Google 尚未完成設定/);
  assert.match(screen, /寄信尚未完成設定/);
  assert.match(screen, /信件登入/);
  assert.doesNotMatch(screen, /Magic Link/);
  assert.match(screen, /建立帳號/);
  assert.doesNotMatch(screen, /建立電子信箱帳號/);
  assert.ok(
    screen.indexOf('htmlFor="login-email"') < screen.indexOf("login-providers"),
    "working email login must appear before unconfigured SSO buttons",
  );
  assert.match(gate, /LoginMascot/);
  assert.match(gate, /next\/dynamic/);
  assert.match(gate, /載入工作區/);
  assert.match(gate, /確認身分/);
  assert.match(gate, /離線/);
  assert.match(gate, /再試一次/);
  assert.match(gate, /auth\.unreachable && !auth\.user/);
  assert.doesNotMatch(gate, /import HermesConsole from/);
  assert.match(screen, /attachKeyboardShell/);
  assert.match(screen, /isLoginKeyboardTarget/);
  assert.match(css, /\.login-stage/);
  assert.match(css, /\.login-turtle[\s\S]*breathe/);
  assert.match(css, /\.login-screen \{[\s\S]*flex-direction: column/);
  assert.match(
    css,
    /data-composer-keyboard="open"\] \.login-stage/,
  );
  assert.match(
    css,
    /data-composer-keyboard="open"\] \.login-screen/,
  );
});
