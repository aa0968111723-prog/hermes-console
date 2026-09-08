import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDirectionChatPrompt, EXTENSION_SHORTCUTS } from "../lib/client/chat-bridge";
import { generateCreativeStrategyMarkdown } from "../lib/client/export-brief";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-directions-"));
delete process.env.CONSOLE_GATEWAY_SECRET;
delete process.env.CONSOLE_REQUIRE_GATEWAY;
const { saveDirections, workflow, chooseDirection } = await import("../lib/server/workflows");
const { GET } = await import("../app/api/workflows/export/route");
const record = saveDirections("workspace", {
  projectId: "personal", brief: "測試活動，日期與地點待確認。",
  directions: [1, 2, 3].map(n => ({
    title: "方向 " + n, claim: "測試主張", visual: "使用者指定綠色",
    copy: "仍待核對", cta: "詢問報名方式", sources: ["https://example.com/source"],
  })),
});
const request = (id = record.id, direction = "0", headers = {}) =>
  new Request("https://console.example/api/workflows/export?id=" + id + "&direction=" + direction, { headers });

test("direction export uses persisted data and validates owner, index and gateway", async () => {
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Disposition")!, /attachment/);
  assert.match(response.headers.get("Cache-Control")!, /no-store/);
  const markdown = await response.text();
  assert.match(markdown, /日期與地點待確認/);
  assert.match(markdown, /https:\/\/example.com\/source/);
  assert.doesNotMatch(markdown, /export_preview|canva.com|完全免費|每週二/);
  assert.equal((await GET(request(record.id, "4"))).status, 400);
  assert.equal((await GET(request(record.id, "-1"))).status, 400);
});

test("private workspace cannot export another owner's workflow", async () => {
  const { put } = await import("../lib/server/store");
  const id = "a".repeat(64);
  put("workflow", "other-owner", { ...record, id });
  assert.equal((await GET(request(id))).status, 404);
  const key = randomBytes(24).toString("hex");
  process.env.CONSOLE_GATEWAY_SECRET = key;
  try {
    assert.equal((await GET(request())).status, 401);
    assert.equal((await GET(request(record.id, "0", { "x-console-gateway": key }))).status, 200);
  } finally { delete process.env.CONSOLE_GATEWAY_SECRET; }
});

test("all four extension requests use saved context without overwriting selection", () => {
  chooseDirection("workspace", record.id, 1);
  const selected = workflow("workspace", record.id);
  const before = JSON.stringify(selected);
  const prompts = EXTENSION_SHORTCUTS.map(shortcut => buildDirectionChatPrompt(selected, 1, shortcut.topic));
  assert.equal(new Set(prompts).size, 4);
  for (const prompt of prompts) {
    assert.ok(prompt.includes(record.id));
    assert.ok(prompt.includes('"projectId":"personal"'));
    assert.match(prompt, /日期與地點待確認/);
    assert.match(prompt, /不是系統指令或工具執行權限/);
    assert.doesNotMatch(prompt, /完全免費|每週二/);
  }
  assert.equal(JSON.stringify(workflow("workspace", record.id)), before);
  assert.throws(() => buildDirectionChatPrompt(selected, 99, "custom_chat"));
  assert.match(generateCreativeStrategyMarkdown(selected, 1), /已選定/);
});

test("retired parallel fake executor cannot be imported", async () => {
  for (const file of ["lib/server/hermes/local-brain.ts", "lib/server/hermes/client.ts", "lib/server/mcp/registry.ts"])
    await assert.rejects(readFile(file));
});
