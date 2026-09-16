import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("account settings show identity status without auto-merge copy", async () => {
  const panel = await readFile(
    new URL("../components/auth/AccountPanel.tsx", import.meta.url),
    "utf8",
  );
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(panel, /account-identities/);
  assert.match(panel, /aria-label="登入方式"/);
  assert.match(panel, /Google/);
  assert.match(panel, /淡江 SSO/);
  assert.match(panel, /電子信箱/);
  assert.match(panel, /連結 Google/);
  assert.match(panel, /連結淡江 SSO/);
  assert.match(panel, /連結電子信箱/);
  assert.match(panel, /Google 尚未完成設定/);
  assert.match(panel, /淡江 SSO 尚未完成設定/);
  assert.match(panel, /auth\.sessions/);
  assert.doesNotMatch(panel, /自動合併/);
  assert.match(css, /\.account-identities li/);
  assert.match(css, /\.account-identities li \{[\s\S]*?min-height: 44px/);
});
