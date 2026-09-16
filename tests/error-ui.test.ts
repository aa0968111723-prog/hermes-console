import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("error surfaces stay Traditional Chinese and do not fake a usable workspace", async () => {
  const boundary = await readFile(
    new URL("../components/ConsoleErrorBoundary.tsx", import.meta.url),
    "utf8",
  );
  const page = await readFile(
    new URL("../app/error.tsx", import.meta.url),
    "utf8",
  );
  const layout = await readFile(
    new URL("../app/layout.tsx", import.meta.url),
    "utf8",
  );
  for (const source of [boundary, page]) {
    assert.match(source, /畫面讀取失敗/);
    assert.doesNotMatch(source, /Creative Intelligence/);
    assert.doesNotMatch(source, /仍可使用此工作區/);
  }
  assert.match(layout, /title: "Hermes"/);
  assert.doesNotMatch(layout, /Creative Intelligence/);
});
