import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-modes-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3220";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
delete process.env.CONSOLE_GATEWAY_SECRET;
process.env.HERMES_API_KEY = randomBytes(24).toString("hex");
process.env.HERMES_API_URL = "https://hermes.example.invalid";

const {
  parseAssistantMode,
  specialistInstructions,
  RESEARCH_INSTRUCTIONS,
  ADMIN_INSTRUCTIONS,
} = await import("../lib/assistant-modes");
const { taskInput } = await import("../lib/server/tasks");
const conversations = await import("../app/api/conversations/route");

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3220/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("assistant modes parse, prompts and API contracts", async (t) => {
  await t.test("unknown values fall back to creative", () => {
    assert.equal(parseAssistantMode(undefined), "creative");
    assert.equal(parseAssistantMode("silly"), "creative");
    assert.equal(parseAssistantMode("research"), "research");
    assert.equal(parseAssistantMode("admin"), "admin");
  });

  await t.test("research prompt is assistive and not IRB", () => {
    assert.match(RESEARCH_INSTRUCTIONS, /教育心理/);
    assert.match(RESEARCH_INSTRUCTIONS, /教心所/);
    assert.match(RESEARCH_INSTRUCTIONS, /IRB/);
    assert.match(RESEARCH_INSTRUCTIONS, /不.*代替/);
    assert.match(RESEARCH_INSTRUCTIONS, /禁止捏造/);
    assert.equal(specialistInstructions("research"), RESEARCH_INSTRUCTIONS);
    assert.equal(specialistInstructions("creative"), null);
  });

  await t.test("admin prompt refuses invented institutional facts", () => {
    assert.match(ADMIN_INSTRUCTIONS, /禁止發明制度事實/);
    assert.match(ADMIN_INSTRUCTIONS, /待確認/);
    assert.match(ADMIN_INSTRUCTIONS, /不代表所辦/);
    assert.equal(specialistInstructions("admin"), ADMIN_INSTRUCTIONS);
  });

  await t.test("task payload accepts only known modes", () => {
    const base = {
      conversationId: randomUUID(),
      requestKey: randomUUID(),
      input: "幫我收斂研究問題",
    };
    assert.equal(
      taskInput.parse({ ...base, mode: "research" }).mode,
      "research",
    );
    assert.equal(taskInput.parse({ ...base, mode: "admin" }).mode, "admin");
    assert.equal(taskInput.parse(base).mode, undefined);
    assert.equal(taskInput.safeParse({ ...base, mode: "silly" }).success, false);
  });

  await t.test("new conversations store the requested assistant mode", async () => {
    const created = await conversations.POST(
      request("conversations", "POST", {
        title: "教心所研究筆記",
        assistantMode: "research",
      }),
    );
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.conversation.assistantMode, "research");
    assert.equal(body.conversation.title, "教心所研究筆記");
  });

  await t.test("omitted mode keeps the default creative console path", async () => {
    const created = await conversations.POST(
      request("conversations", "POST", { title: "一般對話" }),
    );
    const body = await created.json();
    assert.equal(body.conversation.assistantMode, "creative");
    assert.equal(specialistInstructions("creative"), null);
  });
});
