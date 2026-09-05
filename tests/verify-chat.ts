import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";

// Full Console HTTP/browser path against an explicitly isolated protocol fixture.
// This is NOT proof that the user's Zeabur instance is reachable.
let mode = "chat",
  cancelled = false,
  calls = 0;
const fixtureKey = randomBytes(32).toString("hex");
const fixture = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer " + fixtureKey) {
    res.writeHead(401).end();
    return;
  }
  let body = "";
  for await (const part of req) body += part;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/v1/models") {
    res.end(JSON.stringify({ data: [{ id: "contract-fixture" }] }));
    return;
  }
  if (req.url === "/v1/capabilities") {
    res.end(
      JSON.stringify({
        object: "hermes.api_server.capabilities",
        features: {
          run_submission: mode === "runs",
          run_status: mode === "runs",
          run_stop: mode === "runs",
        },
      }),
    );
    return;
  }
  if (req.url === "/v1/toolsets" || req.url === "/v1/skills") {
    res.end("[]");
    return;
  }
  if (req.url === "/v1/runs") {
    calls++;
    res.writeHead(202).end('{"run_id":"contract_run"}');
    return;
  }
  if (req.url === "/v1/runs/contract_run/stop") {
    cancelled = true;
    res.end('{"status":"stopping"}');
    return;
  }
  if (req.url === "/v1/runs/contract_run") {
    res.end(
      JSON.stringify({
        status: cancelled ? "cancelled" : "running",
        model: "contract-fixture",
      }),
    );
    return;
  }
  if (req.url === "/v1/chat/completions") {
    calls++;
    assert.ok(Array.isArray(JSON.parse(body).messages));
    res.setHeader("Content-Type", "text/event-stream");
    let sent = 0;
    const timer = setInterval(() => {
      if (res.destroyed) {
        clearInterval(timer);
        return;
      }
      if (sent++ < 12)
        res.write(
          "data: " +
            JSON.stringify({
              model: "contract-fixture",
              choices: [
                {
                  delta: {
                    content: "【契約測試串流】不是實機回覆。\n\n".repeat(25),
                  },
                },
              ],
            }) +
            "\n\n",
        );
      else {
        clearInterval(timer);
        res.end("data: [DONE]\n\n");
      }
    }, 500);
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:3216";
const data = await mkdtemp(join(tmpdir(), "hermes-browser-contract-"));
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  CONSOLE_ORIGIN: base,
  CONSOLE_USERNAME: "contract-owner",
  CONSOLE_PASSWORD_HASH:
    "scrypt:" + salt + ":" + scryptSync(password, salt, 64).toString("hex"),
  CONSOLE_DATA_DIR: data,
  HERMES_API_URL:
    "http://127.0.0.1:" + (fixture.address() as { port: number }).port,
  HERMES_API_KEY: fixtureKey,
  HERMES_ALLOW_LOOPBACK_HTTP: "true",
  HERMES_CONNECT_TIMEOUT_MS: "2000",
  HERMES_IDLE_TIMEOUT_MS: "2000",
  HERMES_TASK_TIMEOUT_MS: "60000",
  CANVA_CLIENT_ID: "",
  CANVA_CLIENT_SECRET: "",
  MCP_BRIDGE_TOKEN: "",
};
let child: ChildProcess;
let logs = "";
async function start() {
  child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      "3216",
      "-H",
      "127.0.0.1",
    ],
    { env: environment, stdio: "pipe", windowsHide: true },
  );
  child.stdout?.on("data", (data) => {
    logs += data.toString();
  });
  child.stderr?.on("data", (data) => {
    logs += data.toString();
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Console did not start");
}
async function shutdown() {
  if (child && child.exitCode === null) {
    const done = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    child.kill();
    await done;
  }
}
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  await start();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(base);
  await page.getByLabel("帳號", { exact: true }).fill("contract-owner");
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "進入工作區" }).click();
  const textarea = page.getByRole("textbox", { name: "訊息", exact: true });
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "branch-reference.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("契約測試附件，分支必須保留。"),
    });
  await expect(page.locator(".upload-chip")).toContainText("已保存");
  await textarea.fill("隔離契約：長任務穿越背景監測週期");
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止任務", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".message.assistant .markdown")).toContainText(
    "契約測試串流",
    { timeout: 15000 },
  );
  await page.locator(".conversation-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(
    page.getByRole("button", { name: "回到最新訊息" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "執行紀錄", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  assert.ok(
    await page
      .locator(".conversation-scroll")
      .evaluate((el) => el.scrollTop < 100),
    "incoming output must not move someone reading older messages",
  );
  await page.getByRole("button", { name: "回到最新訊息" }).click();
  await expect(
    page.getByRole("button", { name: "回到最新訊息" }),
  ).not.toBeVisible();
  assert.equal(calls, 1);
  const tasks = await (await context.request.get(base + "/api/tasks")).json();
  assert.equal(
    tasks.tasks[0].state,
    "completed",
    "live Next bundles must share the worker registry",
  );
  assert.equal(tasks.tasks[0].usage.totalTokens, null);
  await page
    .getByRole("button", { name: "編輯並建立分支", exact: true })
    .click();
  await expect(textarea).toHaveValue("隔離契約：長任務穿越背景監測週期");
  await expect(page.locator(".upload-chip")).toContainText(
    "branch-reference.txt",
  );
  const branched = await (
    await context.request.get(base + "/api/workspace")
  ).json();
  assert.equal(branched.conversations.length, 2);
  assert.equal(
    branched.conversations.find((c: { parentId?: string }) => !c.parentId)
      .messages.length,
    2,
    "branch must preserve original user and assistant messages",
  );
  mode = "runs";
  await context.request.post(base + "/api/health", {
    headers: { Origin: base },
    data: {},
  });
  await page.getByRole("button", { name: "開啟新對話", exact: true }).click();
  await textarea.fill("隔離契約：重啟後查回原生任務");
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止任務", exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 30; i++) {
    const result = await (
      await context.request.get(base + "/api/tasks")
    ).json();
    if (
      result.tasks.some(
        (t: { remoteId: string }) => t.remoteId === "contract_run",
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await shutdown();
  await start();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "停止任務", exact: true }),
  ).toBeVisible();
  assert.equal(calls, 2, "restarting Console must not resubmit Hermes work");
  await page.getByRole("button", { name: "停止任務", exact: true }).click();
  await expect(page.locator(".task-status")).toContainText("已停止", {
    timeout: 10000,
  });
  assert.equal(cancelled, true);
  assert.equal(calls, 2);
  assert.ok(!logs.includes(password));
  assert.ok(!logs.includes(fixtureKey));
  console.log(
    "PASS: full browser -> Console -> contract server long stream, read without forced scrolling, reload, attachment-preserving branch, native run persistence across actual Console process restart, real stop HTTP, no duplicate submission. NOT Zeabur live validation.",
  );
} finally {
  await browser.close();
  await shutdown();
  fixture.closeAllConnections();
  fixture.close();
}
