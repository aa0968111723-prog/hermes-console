import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dataDir = await mkdtemp(join(tmpdir(), "hermes-entry-"));
const port = Number(process.env.ENTRY_TEST_PORT || 3220);
const base = "http://127.0.0.1:" + port;
process.env.CONSOLE_DATA_DIR = dataDir;
process.env.CONSOLE_ORIGIN = base;
process.env.CONSOLE_ALLOW_LOCAL_ACCESS = "true";

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_ORIGIN: base,
      CONSOLE_ALLOW_LOCAL_ACCESS: "true",
      CONSOLE_AUTH_REQUIRED: "",
      CONSOLE_GATEWAY_SECRET: "",
      CONSOLE_REQUIRE_GATEWAY: "false",
      CONSOLE_ADMIN_EMAILS: "",
      RESEND_API_KEY: "",
      CONSOLE_EMAIL_FROM: "",
      CONSOLE_DATA_DIR: dataDir,
      HERMES_API_URL: "",
      HERMES_API_KEY: "",
    },
  },
);
let logs = "";
child.stdout?.on("data", (chunk) => {
  logs += chunk;
});
child.stderr?.on("data", (chunk) => {
  logs += chunk;
});

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (child.exitCode !== null) throw new Error("Preview server exited\n" + logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  const workspace = await fetch(base + "/api/workspace");
  assert.equal(workspace.status, 200, "no-login workspace GET");
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.live, true);
  assert.doesNotMatch(JSON.stringify(healthBody), /Bearer |sk-|postgres(?:ql)?:\/\//i);
  const runtime = await fetch(base + "/api/runtime");
  assert.notEqual(runtime.status, 401);
  const tasks = await fetch(base + "/api/tasks");
  assert.equal(tasks.status, 200);
  const artifacts = await fetch(base + "/api/artifacts");
  assert.equal(artifacts.status, 200);
  const cross = await fetch(base + "/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ name: "blocked" }),
  });
  assert.equal(cross.status, 403);
  const created = await fetch(base + "/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ title: "免登入對話" }),
  });
  assert.equal(created.status, 201);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const output = resolve("output/playwright");
  await mkdir(output, { recursive: true });

  await page.goto(base);
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登入 Hermes" })).toHaveCount(0);
  await expect(page.getByText("無法確認登入狀態")).toHaveCount(0);
  await expect(page.getByText("正在確認身分")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "語音輸入" })).toHaveCount(0);
  await page.screenshot({ path: join(output, "home-mobile.png"), fullPage: true });

  await page.goto(base + "/#reset=" + "a".repeat(64));
  await expect(page.getByRole("heading", { name: "重設密碼" })).toBeVisible();
  await expect(page.getByLabel("新密碼")).toBeVisible();
  await page.screenshot({ path: join(output, "login-reset-hash.png"), fullPage: true });
  await page.getByRole("button", { name: "密碼登入" }).click();
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();

  assert.deepEqual(errors, []);
  console.log(
    "PASS: no-login `/` enters workspace, APIs are not a login wall, reset hash still opens the dormant form. Not live Zeabur.",
  );
} finally {
  await browser?.close();
  child.kill();
}
