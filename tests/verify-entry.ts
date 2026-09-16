import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { signInConsole } from "./playwright-login";

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
  const workspace = await fetch(base + "/api/workspace");
  assert.equal(workspace.status, 401, "workspace GET requires a session");
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  const runtime = await fetch(base + "/api/runtime");
  assert.equal(runtime.status, 401, "runtime requires a session");
  const tasks = await fetch(base + "/api/tasks");
  assert.equal(tasks.status, 401);
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
  assert.equal(created.status, 401);
  const output = resolve("output/playwright");
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Hermes", exact: true })).toBeVisible();
  await expect(page.getByText("Google 登入尚未完成設定", { exact: true })).toBeVisible();
  await expect(page.getByText("淡江 SSO 尚未完成設定", { exact: true })).toBeVisible();
  await page.screenshot({
    path: join(output, "login-mobile.png"),
    fullPage: true,
  });
  await signInConsole(page);
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toBeVisible();
  await expect(page.locator(".connection-pill")).toContainText("未設定");
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill(
    "幫我找淡大禪學社茶會宣傳靈感",
  );
  await page.getByRole("button", { name: "送出訊息" }).click();
  await expect(page.getByText("Hermes Agent 尚未連線")).toBeVisible();
  await expect(page.getByText("本地索引", { exact: true })).toBeVisible();
  await expect(page.getByText(/Drive 快照/)).toBeVisible();
  const chat = await page.locator("body").innerText();
  assert.equal(chat.includes("已搜尋整個 Instagram"), false);
  await page.screenshot({
    path: join(output, "chat-local-knowledge-mobile.png"),
    fullPage: true,
  });
  const authed = await page.request.post(base + "/api/conversations", {
    headers: { Origin: base },
    data: { title: "登入後對話" },
  });
  assert.equal(authed.status(), 201);
  const text = await page.locator("body").innerText();
  for (const word of [
    "受邀電子信箱",
    "寄送登入連結",
    "歡迎回到 Hermes",
    "正在驗證工作區存取",
  ])
    assert.ok(!text.includes(word), "invitation UI visible: " + word);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByRole("tab", { name: "帳號", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登入方式" })).toBeVisible();
  await expect(page.getByText("電子信箱 ✓", { exact: true })).toBeVisible();
  await expect(page.getByText("工作區角色：擁有者")).toBeVisible();
  const linkButtons = page.getByRole("link", { name: "連結", exact: true });
  await expect(linkButtons).toHaveCount(2);
  await expect(linkButtons.nth(0)).toHaveAttribute(
    "href",
    "/api/auth/google/start",
  );
  await expect(linkButtons.nth(1)).toHaveAttribute(
    "href",
    "/api/auth/tamkang/start",
  );
  await expect(
    page.getByText("不會只因為電子信箱相同就自動合併帳號。"),
  ).toBeVisible();
  await page.screenshot({
    path: join(output, "account-mobile.png"),
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: login gate then workspace, session-required APIs, origin-bound mutation, Hermes unconfigured UI, honest Google/Tamkang hints, local club index without fake MCP, account identities. Not live Zeabur.",
  );
} finally {
  await browser?.close();
  child.kill();
}
