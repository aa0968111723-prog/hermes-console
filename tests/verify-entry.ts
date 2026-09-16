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

async function captureMail(run: () => Promise<void>) {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.CONSOLE_EMAIL_FROM;
  process.env.RESEND_API_KEY = "test-resend-not-for-production-use";
  process.env.CONSOLE_EMAIL_FROM = "console@example.test";
  const emails: Array<{ text: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://api.resend.com/emails") {
      emails.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "fixture-mail-" + emails.length });
    }
    return original(url as never, init);
  };
  try {
    await run();
    return emails;
  } finally {
    globalThis.fetch = original;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.CONSOLE_EMAIL_FROM;
    else process.env.CONSOLE_EMAIL_FROM = previousFrom;
  }
}

function tokenFrom(text: string, kind: "login" | "reset" | "verify") {
  const match = text.match(new RegExp("#" + kind + "=([a-f0-9]{64})"));
  assert.ok(match, kind + " token missing from mail");
  return match[1];
}

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
  const healthBody = await health.json();
  assert.equal(healthBody.live, true);
  assert.doesNotMatch(JSON.stringify(healthBody), /Bearer |sk-|postgres(?:ql)?:\/\//i);
  const runtime = await fetch(base + "/api/runtime");
  assert.equal(runtime.status, 401);
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
    body: JSON.stringify({ title: "匿名對話" }),
  });
  assert.equal(created.status, 401);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const output = resolve("output/playwright");
  await mkdir(output, { recursive: true });

  async function signOut() {
    await page.evaluate(async () => {
      await fetch("/api/auth", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    });
  }

  async function openAuthHash(kind: "login" | "reset" | "verify", value: string) {
    await page.goto("about:blank");
    await page.goto(base + "/#" + kind + "=" + value, {
      waitUntil: "domcontentloaded",
    });
  }

  await page.goto(base);
  await expect(page.getByRole("heading", { name: "登入 Hermes" })).toBeVisible();
  await expect(page.getByText("淡江 SSO 尚未完成設定")).toBeVisible();
  await expect(page.getByText("Google 登入尚未完成設定")).toBeVisible();
  await expect(page.getByText("尚未設定寄件，無法寄送登入或重設連結")).toBeVisible();
  await page.screenshot({ path: join(output, "login-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "登入連結", exact: true }).click();
  await expect(page.getByRole("button", { name: "寄送登入連結" })).toHaveCount(0);
  await expect(page.getByText("尚未設定寄件，無法寄送登入或重設連結")).toBeVisible();
  await page.screenshot({
    path: join(output, "login-magic-unconfigured.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "忘記密碼", exact: true }).click();
  await expect(page.getByRole("button", { name: "寄送重設連結" })).toHaveCount(0);
  await expect(page.getByText("尚未設定寄件，無法寄送登入或重設連結")).toBeVisible();
  await page.screenshot({
    path: join(output, "login-forgot-unconfigured.png"),
    fullPage: true,
  });

  await openAuthHash("login", "a".repeat(64));
  await expect(page.getByRole("button", { name: "確認登入" })).toBeVisible();
  await page.getByRole("button", { name: "確認登入" }).click();
  await expect(page.locator(".login-card [role='alert']")).toContainText(
    "連結已使用、已過期或不存在",
  );
  await expect(page.getByRole("heading", { name: "登入 Hermes" })).toBeVisible();

  await page.getByRole("button", { name: "建立帳號", exact: true }).click();
  await page.getByLabel("名稱").fill("測試擁有者");
  await page.getByLabel("電子信箱").fill("owner@example.test");
  await page.getByLabel("密碼").fill("Test-Password-14");
  await page.locator("form").getByRole("button", { name: "建立帳號" }).click();
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toBeVisible();
  await page.screenshot({ path: join(output, "home-mobile.png"), fullPage: true });
  const session = (await context.cookies()).find((row) => row.name === "hermes_session")?.value;
  assert.ok(session);
  const signed = await fetch(base + "/api/workspace", {
    headers: { Cookie: "hermes_session=" + session },
  });
  assert.equal(signed.status, 200);

  await signOut();
  const identity = await import("../lib/server/identity");
  const magicMail = await captureMail(async () => {
    await identity.requestMagicLink("owner@example.test");
  });
  const magicToken = tokenFrom(magicMail[0].text, "login");
  await openAuthHash("login", magicToken);
  await expect(page.getByRole("button", { name: "確認登入" })).toBeVisible();
  await page.getByRole("button", { name: "確認登入" }).click();
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await page.screenshot({ path: join(output, "login-magic-redeem.png"), fullPage: true });

  await signOut();
  const resetMail = await captureMail(async () => {
    await identity.requestPasswordReset("owner@example.test");
  });
  const resetToken = tokenFrom(resetMail[0].text, "reset");
  await openAuthHash("reset", resetToken);
  await expect(page.getByLabel("新密碼")).toBeVisible();
  await page.getByLabel("新密碼").fill("New-Password-14");
  await page.getByRole("button", { name: "重設密碼" }).click();
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await page.screenshot({ path: join(output, "login-reset.png"), fullPage: true });

  await signOut();
  const verifyMail = await captureMail(async () => {
    await identity.registerEmail({
      email: "member@example.test",
      password: "Member-Password-14",
      name: "成員",
    });
  });
  const verifyToken = tokenFrom(verifyMail[0].text, "verify");
  await openAuthHash("verify", verifyToken);
  await expect(page.getByRole("button", { name: "完成驗證" })).toBeVisible();
  await page.getByRole("button", { name: "完成驗證" }).click();
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await page.screenshot({ path: join(output, "login-verify.png"), fullPage: true });

  await signOut();
  await context.clearCookies();
  const googleSession = identity.loginWithIdentity({
    provider: "google",
    providerId: "google-sub-link-ui",
    email: "google-link@example.test",
    emailVerified: true,
    name: "Google 連結",
  });
  await context.addCookies([
    {
      name: "hermes_session",
      value: googleSession,
      url: base,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByRole("tab", { name: "帳號", exact: true }).click();
  const account = page.getByRole("tabpanel", { name: "帳號" });
  await expect(account.getByText("電子信箱", { exact: true })).toBeVisible();
  await expect(
    account.locator(".identity-list li").filter({ hasText: "電子信箱" }),
  ).toContainText("未連結");
  await expect(account.getByText("尚未設定寄件，無法連結並驗證電子信箱")).toBeVisible();
  await expect(account.getByRole("button", { name: "連結信箱" })).toHaveCount(0);
  await page.screenshot({
    path: join(output, "settings-account-link-unconfigured.png"),
    fullPage: true,
  });

  assert.deepEqual(errors, []);
  console.log(
    "PASS: login gate, unconfigured Google/Tamkang/mail, invalid magic link, first owner register, magic redeem, password reset, email verify, email-link honesty. Not live Zeabur.",
  );
} finally {
  await browser?.close();
  child.kill();
}
