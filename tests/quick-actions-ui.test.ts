import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("home quick actions keep all six labels on mobile", async () => {
  const source = await readFile(
    new URL("../components/visual/QuickActions.tsx", import.meta.url),
    "utf8",
  );
  const conversation = await readFile(
    new URL("../components/console/Conversation.tsx", import.meta.url),
    "utf8",
  );
  for (const label of ["研究", "創作", "分析", "客群", "靈感", "設計"]) {
    assert.match(source, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(source, /actions\.slice\(0,\s*4\)/);
  assert.doesNotMatch(source, /幫我找 IG/);
  assert.match(source, /只用可取得的公開來源/);
  assert.match(conversation, /<QuickActions onSelect=\{onQuickAction\} \/>/);
  const css = await readFile(
    new URL("../app/mobile-spatial.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.quick-actions \{[\s\S]*?repeat\(3,/);
  assert.doesNotMatch(
    css,
    /\.quick-actions \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/,
  );
});
