import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("TKU AI runtime names xAI OAuth and refuses invented club facts", async () => {
  const skill = await readFile(
    join(root, "runtime/tku-ai/skills/tku-zenclub/SKILL.md"),
    "utf8",
  );
  const doc = await readFile(join(root, "docs/TKU_AI.md"), "utf8");
  const config = await readFile(
    join(root, "runtime/tku-ai/config.yaml.example"),
    "utf8",
  );
  assert.match(skill, /UNKNOWN/);
  assert.match(skill, /CONFLICTING/);
  assert.match(skill, /領袖禪學社/);
  assert.match(skill, /淡江大學禪學社/);
  assert.match(doc, /xai-oauth/);
  assert.match(config, /provider: xai-oauth/);
  assert.doesNotMatch(skill + doc + config, /nvapi-|sk-|gho_|xai-[A-Za-z0-9]{8,}/);
});
