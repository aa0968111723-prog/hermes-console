import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("image attachments stay honest when Hermes image input is unverified", async () => {
  const tray = await readFile(
    join(process.cwd(), "components/visual/ContextTray.tsx"),
    "utf8",
  );
  const consoleSource = await readFile(
    join(process.cwd(), "components/HermesConsole.tsx"),
    "utf8",
  );
  const inspector = await readFile(
    join(process.cwd(), "components/RuntimeInspector.tsx"),
    "utf8",
  );
  const sync = await readFile(
    join(process.cwd(), "lib/server/hermes/sync-manager.ts"),
    "utf8",
  );
  assert.match(tray, /尚未驗證讀圖/);
  assert.doesNotMatch(consoleSource, /imageAttached && !data\.imageInput/);
  assert.doesNotMatch(consoleSource, /部署端尚未驗證圖片輸入/);
  assert.match(inspector, /讀圖 \{statusLabel\(snapshot\.imageInputSupport\)\}/);
  assert.match(
    sync,
    /HERMES_IMAGE_INPUT === "true" \? "available" : "unsupported"/,
  );
  assert.doesNotMatch(sync, /imageInputSupport: "unknown"/);
});
