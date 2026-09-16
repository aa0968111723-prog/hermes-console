import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("password reset hash opens a new-password form instead of auto-login", async () => {
  const gate = await readFile(
    join(process.cwd(), "components/auth/AuthGate.tsx"),
    "utf8",
  );
  const login = await readFile(
    join(process.cwd(), "components/auth/LoginScreen.tsx"),
    "utf8",
  );
  assert.match(gate, /hash\.get\("reset"\)/);
  assert.match(gate, /setResetToken\(reset\)/);
  assert.match(gate, /resetToken=\{resetToken\}/);
  assert.match(gate, /hashchange/);
  assert.match(gate, /applyReset/);
  assert.match(gate, /if \(boot\.login \|\| boot\.verify\)/);
  const redeemBlock = gate.slice(
    gate.indexOf("if (boot.login || boot.verify)"),
    gate.indexOf("await load()"),
  );
  assert.doesNotMatch(redeemBlock, /action: \"reset\"/);
  assert.match(login, /action === "reset"/);
  assert.match(login, /重設密碼/);
  assert.match(login, /儲存新密碼/);
  assert.match(login, /token: resetToken/);
  assert.match(
    login,
    /action === "reset"\s*\? \{ action, token: resetToken, password:/,
  );
});
