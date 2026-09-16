import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("composer dock is extracted from HermesConsole", async () => {
  const consoleUi = await readFile(
    new URL("../components/HermesConsole.tsx", import.meta.url),
    "utf8",
  );
  const composer = await readFile(
    new URL("../components/console/Composer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(consoleUi, /console\/Composer/);
  assert.doesNotMatch(consoleUi, /className="composer-area"/);
  assert.match(composer, /className="composer-area"/);
  assert.match(composer, /placeholder="想做什麼？"/);
  assert.match(composer, /ComposerMenu/);
  assert.match(composer, /composer-uncertain-hint/);
});
