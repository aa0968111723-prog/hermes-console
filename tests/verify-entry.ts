import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signInEmail } from "./browser-login";

const dataDir = await mkdtemp(join(tmpdir(), "hermes-entry-"));
const port = Number(process.env.ENTRY_TEST_PORT || 3220);
const base = "http://127.0.0.1:" + port;
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
  const workspaceAnon = await fetch(base + "/api/workspace");
  assert.equal(workspaceAnon.status, 401, "workspace GET requires a session in production");
  const live = await fetch(base + "/api/live");
  assert.equal(live.status, 200);
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  const ready = await fetch(base + "/api/ready");
  assert.equal(ready.status, 200);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Hermes", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "淡江 SSO", exact: true })).toBeDisabled();
  await expect(page.getByText("淡江 SSO 尚未完成設定")).toBeVisible();
  await expect(page.getByRole("button", { name: "信件登入" })).toBeVisible();
  await expect(page.getByRole("button", { name: "忘記密碼" })).toBeVisible();
  await expect(page.getByText("寄信尚未完成設定")).toBeVisible();
  await page.evaluate((token) => {
    window.location.hash = "verify=" + token;
  }, "a".repeat(64));
  await expect(page.locator(".login-card .error")).toContainText(
    /無效|過期|不存在/,
  );
  await signInEmail(page);
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toBeVisible();
  const workspace = await fetch(base + "/api/workspace");
  assert.equal(workspace.status, 401, "cookie-less fetch still unauthorized");
  assert.equal((await fetch(base + "/api/runtime")).status, 401);
  assert.equal((await page.request.get(base + "/api/workspace")).status(), 200);
  await expect(page.locator(".connection-pill")).toContainText("未設定");
  const text = await page.locator("body").innerText();
  for (const word of [
    "受邀電子信箱",
    "寄送登入連結",
    "歡迎回到 Hermes",
    "正在驗證工作區存取",
  ])
    assert.ok(!text.includes(word), "invitation UI visible: " + word);
  assert.deepEqual(errors, []);
  console.log("PASS: AuthGate root page, session-gated workspace APIs, origin-bound mutation, Hermes unconfigured UI. Not live Zeabur.");
} finally {
  await browser?.close();
  child.kill();
}
