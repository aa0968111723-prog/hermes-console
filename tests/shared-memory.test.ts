import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-memory-"));
process.env.CONSOLE_ORIGIN = "http://localhost:3240";
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";
process.env.CONSOLE_GATEWAY_SECRET = "";
process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
delete process.env.HERMES_LEARNING_SCOPE_VERIFIED;

const memoryApi = await import("../app/api/memory/route");
const workspace = await import("../app/api/workspace/route");
const { saveMemory, listMemories, deleteMemory, memoryDigest } =
  await import("../lib/server/memory");
const { callTool } = await import("../lib/server/mcp");

function request(path: string, method = "GET", body?: unknown) {
  return new Request("http://localhost:3240/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: process.env.CONSOLE_ORIGIN!,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("shared memory persists and is the Hermes Console store", async (t) => {
  await t.test("API create/list/update/delete and rejects secrets", async () => {
    const created = await memoryApi.POST(
      request("memory", "POST", {
        kind: "note",
        scope: "workspace",
        title: "教心所常用縮寫",
        content: "IRB 不是本工具可代替的審查。",
        tags: ["tku"],
      }),
    );
    assert.equal(created.status, 201);
    const saved = (await created.json()).memory;
    assert.equal(saved.revision, 1);
    const listed = await memoryApi.GET(request("memory?scope=all"));
    assert.equal(listed.status, 200);
    const body = await listed.json();
    assert.equal(body.share.store, "console-sqlite");
    assert.equal(body.share.synced, false);
    assert.match(body.share.notice, /不會宣稱已對齊|不是 Hermes 遠端記憶/);
    assert.equal(body.memories[0].title, "教心所常用縮寫");

    const updated = await memoryApi.POST(
      request("memory", "POST", {
        id: saved.id,
        expectedRevision: 1,
        kind: "note",
        scope: "workspace",
        title: "教心所常用縮寫",
        content: "IRB 需由審查單位判斷。",
        tags: ["tku"],
      }),
    );
    assert.equal(updated.status, 201);
    assert.equal((await updated.json()).memory.revision, 2);

    process.env.TEST_MEMORY_SECRET = randomBytes(24).toString("hex");
    const rejected = await memoryApi.POST(
      request("memory", "POST", {
        kind: "fact",
        title: "leak",
        content: "API_KEY=" + process.env.TEST_MEMORY_SECRET,
      }),
    );
    assert.equal(rejected.status, 400);
    delete process.env.TEST_MEMORY_SECRET;

    const removed = await memoryApi.DELETE(
      request("memory", "DELETE", { id: saved.id }),
    );
    assert.equal(removed.status, 200);
    assert.equal(listMemories("workspace").length, 0);

    const blocked = await memoryApi.POST(
      new Request("http://localhost:3240/api/memory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
        },
        body: JSON.stringify({
          kind: "note",
          title: "blocked",
          content: "不應寫入。",
        }),
      }),
    );
    assert.equal(blocked.status, 403);
  });

  await t.test("MCP tools read and write the same SQLite rows", async () => {
    process.env.MCP_REQUIRE_TASK_CONTEXT = "false";
    const memory = saveMemory("workspace", {
      kind: "preference",
      title: "語氣",
      content: "使用繁體中文。",
    });
    const listed = await callTool("workspace", "workspace_list_memories", {});
    assert.equal(listed.isError, false);
    const text = String((listed.content as Array<{ text?: string }>)[0].text);
    assert.match(text, /語氣/);
    const fetched = await callTool("workspace", "workspace_get_memory", {
      memoryId: memory.id,
    });
    assert.equal(fetched.isError, false);
    const written = await callTool("workspace", "workspace_save_memory", {
      kind: "fact",
      title: "MCP 寫入",
      content: "同一資料表。",
      scope: "workspace",
    });
    assert.equal(written.isError, false);
    assert.ok(listMemories("workspace").some((item) => item.title === "MCP 寫入"));
    const gone = await callTool("workspace", "workspace_delete_memory", {
      memoryId: memory.id,
    });
    assert.equal(gone.isError, false);
    assert.equal(
      listMemories("workspace").some((item) => item.id === memory.id),
      false,
    );
    delete process.env.MCP_REQUIRE_TASK_CONTEXT;
  });

  await t.test("workspace GET does not claim remote memory is synced", async () => {
    const response = await workspace.GET(request("workspace"));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.memory.synced, false);
    assert.equal(body.memory.store, "console-sqlite");
  });

  await t.test("task instructions can include the same store digest", () => {
    saveMemory("workspace", {
      kind: "note",
      title: "摘要用",
      content: "這會進入任務指示。",
      scope: "personal",
    });
    const digest = memoryDigest("workspace", "personal");
    assert.match(digest, /摘要用/);
    assert.match(digest, /不是 Hermes 遠端記憶鏡像/);
  });

  await t.test("delete helper removes rows", () => {
    const item = saveMemory("workspace", {
      kind: "scope",
      title: "範圍",
      content: "僅此工作區。",
    });
    assert.deepEqual(deleteMemory("workspace", item.id), {
      deleted: true,
      id: item.id,
    });
  });

  await t.test("settings UI talks to /api/memory and does not bake secrets", async () => {
    const ui = await readFile(
      new URL("../components/settings/SharedMemory.tsx", import.meta.url),
      "utf8",
    );
    assert.match(ui, /\/api\/memory/);
    assert.match(ui, /未宣稱已鏡像/);
    assert.doesNotMatch(ui, /HERMES_API_KEY\s*=/);
    assert.doesNotMatch(ui, /sk-[a-zA-Z0-9_-]{12,}/);
  });
});
