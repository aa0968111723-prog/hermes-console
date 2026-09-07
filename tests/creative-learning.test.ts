import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { seedSession } from "./session-fixture";
import type { Activity, CopyDocument } from "../lib/creative";
import type { LearningNode } from "../lib/learning";
import type { Task } from "../lib/contracts";
process.env.CONSOLE_DATA_DIR = await mkdtemp(join(tmpdir(), "hermes-workbench-"));
process.env.CONSOLE_ORIGIN = "https://console.example";
const cookie = seedSession().cookie;
const c = await import("../lib/server/creative");
const w = await import("../lib/server/workflows");
const l = await import("../lib/server/learning");
const { put, get, list } = await import("../lib/server/store");
const { callTool, toolsList } = await import("../lib/server/mcp");
const creativeApi = await import("../app/api/creative/route");
const learningApi = await import("../app/api/learning/route");
const req = (method = "GET", body?: unknown, query = "", authorized = true) => new Request("https://console.example/api/creative" + query, {
  method, headers: { Origin: "https://console.example", "Content-Type": "application/json", Cookie: authorized ? cookie : "" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
function taskContext(projectId = "personal") {
  const conversationId = randomUUID(), taskId = randomUUID();
  put("conversation", "workspace", { id: conversationId, projectId, messages: [] });
  put("task", "workspace", { id: taskId, conversationId, state: "running", events: [], attachments: [] });
  return taskId;
}
const fact = (field: "name" | "date" | "location" | "contact", value: string, visibility: "public" | "private" = "public") =>
  ({ field, value, visibility, sources: [] });
test("activity → selected directions → pages → revision → download uses persistent handlers and actual MCP calls", async () => {
  assert.equal((await creativeApi.GET(req("GET", undefined, "", false))).status, 200);
  const taskId = taskContext();
  const args = { projectId: "personal", title: "TEST ONLY 活動", expectedRevision: 0, operationId: randomUUID(),
    facts: [fact("name", "測試活動"), fact("date", "2026-10-01"), fact("date", "2026-10-02"), fact("location", "測試場地"), fact("contact", "私", "private")] };
  const result = await callTool("workspace", "workspace_save_activity", { ...args, taskId }, "save-activity-1");
  assert.equal(result.isError, false);
  const info = (result as {structuredContent: {result: Activity}}).structuredContent.result;
  assert.ok(!JSON.stringify(info).includes('"value":"私"'));
  assert.ok(info.facts.every(f => f.state === "pending"));
  assert.equal(c.saveActivity("workspace", args, "hermes").id, info.id);
  assert.throws(() => c.confirmFacts("workspace", info.id, 1, info.facts.filter(f => f.field === "date").map(f => f.id)), /同一欄位/);
  const confirmed = c.confirmFacts("workspace", info.id, 1, info.facts.filter(f => f.value !== "2026-10-02").map(f => f.id));
  const workflow = w.saveDirections("workspace", {
    projectId: "personal", activityId: info.id, brief: "測試需求",
    directions: [1,2,3].map(i => ({ title: "方向 " + i, claim: "測試", visual: "待製作", copy: "測試文案", cta: "報名", sources: [] })),
  });
  const input = { projectId: "personal", activityId: info.id, workflowId: workflow.id,
    expectedRevision: 0, operationId: randomUUID(), title: "TEST ONLY 輪播", format: "carousel" as const, tone: "", audience: "",
    pages: [{ title: "第一頁", body: "測試活動 2026-10-01 測試場地", visual: "" }, { title: "第二頁", body: "原始第二頁", visual: "" }],
    materialIds: [], factIds: confirmed.facts.filter(f => f.state === "confirmed").map(f => f.id) };
  assert.throws(() => c.saveCopy("workspace", input, "hermes"), /先由使用者/);
  w.chooseDirection("workspace", workflow.id, 1);
  const response = await callTool("workspace", "workspace_save_copy", { ...input, taskId }, "save-copy-1");
  assert.equal(response.isError, false);
  let doc = (response as {structuredContent: {result: CopyDocument}}).structuredContent.result;
  c.selectCopy("workspace", doc.id, 1, 1);
  doc = c.saveCopy("workspace", { ...input, id: doc.id, expectedRevision: 1, operationId: randomUUID(),
    pages: [input.pages[0], { ...input.pages[1], body: "第二頁縮短" }] }, "owner");
  assert.equal(doc.revisions.length, 2);
  assert.equal(doc.selectedRevision, 1);
  assert.equal(doc.revisions[0].pages[1].body, "原始第二頁");
  assert.equal(doc.revisions[1].pages[0].body, doc.revisions[0].pages[0].body);
  assert.throws(() => c.saveCopy("workspace", { ...input, id: doc.id, expectedRevision: 1, operationId: randomUUID() }, "owner"), /已被修改/);
  const download = await creativeApi.GET(req("GET", undefined, "?download=" + doc.id + "&revision=1"));
  assert.equal(download.status, 200);
  assert.match(await download.text(), /原始第二頁/);
  assert.equal(c.checkCopy("workspace", doc).automaticVerificationComplete, false);
  assert.throws(() => c.saveCopy("workspace", { ...input, operationId: randomUUID(), pages: [{title: "", body: "私", visual: ""}] }, "hermes"), /私人活動/);
  put("project", "workspace", {id: "other", name: "other"});
  assert.equal((await callTool("workspace", "workspace_get_copy", { copyId: doc.id, taskId: taskContext("other") })).isError, true);
  assert.ok(list("tool_receipt", "workspace").length >= 3);
  assert.ok(!toolsList("workspace").some(t => /confirm|select/.test(t.name) && t.name.startsWith("workspace_")));
});

test("learning tree persists revisions, rejects cycles/scopes/secrets and does not claim offline learning", async () => {
  assert.equal((await learningApi.GET(req("GET", undefined, "", false))).status, 200);
  const input = { projectId: "personal", operationId: randomUUID(), expectedRevision: 0, parentId: null,
    title: "品牌", category: "brand" as const, content: "使用清楚、親切的語氣。", sources: [] };
  const root = l.saveLearning("workspace", input);
  assert.equal(l.saveLearning("workspace", input).id, root.id);
  const child = l.saveLearning("workspace", { ...input, title: "貼文語氣", operationId: randomUUID(), parentId: root.id });
  assert.throws(() => l.saveLearning("workspace", { ...input, id: root.id, expectedRevision: 1, operationId: randomUUID(), parentId: child.id }), /循環/);
  assert.throws(() => l.saveLearning("workspace", { ...input, projectId: "other", operationId: randomUUID(), parentId: root.id }), /此專案/);
  process.env.TEST_MEMORY_SECRET = randomBytes(32).toString("hex");
  assert.throws(() => l.saveLearning("workspace", { ...input, operationId: randomUUID(), content: process.env.TEST_MEMORY_SECRET! }), /憑證/);
  const offline = await l.startLearning("workspace", root.id, 1, "learn");
  assert.equal(offline.state, "waiting_configuration");
  assert.equal(offline.remoteVerified, false);
  assert.equal(offline.attempts[0].taskId, null);
  delete process.env.TEST_MEMORY_SECRET;
});

test("learning submits to real HTTP executor; plain model success never proves persisted memory", async () => {
  let submissions = 0;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models") return void res.end(JSON.stringify({data:[{id:"fixture"}]}));
    if (req.url === "/v1/capabilities") return void res.end(JSON.stringify({object:"hermes.api_server.capabilities",features:{}}));
    if (req.url === "/v1/toolsets") return void res.end(JSON.stringify([{name:"memory",enabled:true,tools:["memory"]}]));
    if (req.url === "/v1/skills") return void res.end("[]");
    if (req.url === "/v1/chat/completions") {
      submissions++;
      assert.match(body, /Console 節點/);
      res.setHeader("Content-Type", "text/event-stream");
      res.end('data: {"choices":[{"delta":{"content":"我已記住。"}}]}\n\ndata: [DONE]\n\n');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  process.env.HERMES_API_URL = "http://127.0.0.1:" + (server.address() as {port:number}).port;
  process.env.HERMES_API_KEY = randomBytes(32).toString("hex");
  process.env.HERMES_ALLOW_LOOPBACK_HTTP = "true";
  process.env.HERMES_LEARNING_SCOPE_VERIFIED = "true";
  try {
    const node = l.saveLearning("workspace", {projectId:"personal",expectedRevision:0,operationId:randomUUID(),parentId:null,category:"preference",title:"TEST preference",content:"繁體中文",sources:[]});
    const started = await l.startLearning("workspace", node.id, 1, "learn");
    assert.ok(started.attempts[0].taskId, JSON.stringify(started));
    await l.startLearning("workspace", node.id, 1, "learn");
    for (let i=0;i<100;i++) {
      if (get<Task>("task","workspace",started.attempts[0].taskId!)?.state === "completed") break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    const view = l.learningView("workspace", l.learningNode("workspace", node.id));
    assert.equal(view.state, "review_required");
    assert.equal(view.remoteVerified, false);
    assert.equal(submissions, 1);
    assert.equal(l.listLearning("workspace","other").length, 0);
  } finally { server.closeAllConnections(); server.close(); }
});
