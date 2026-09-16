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
  assert.match(String(healthBody.message || ""), /還沒準備好/);
  assert.doesNotMatch(
    String(healthBody.message || ""),
    /連線頁|HERMES_API|環境變數/,
  );
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
  await context.addInitScript(`
    class FakeSpeechRecognition {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult = null;
      onerror = null;
      onend = null;
      start() { window.__hermesSpeech = this; }
      stop() { if (this.onend) this.onend(); }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  `);
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
  const voice = page.getByRole("button", { name: "語音輸入" });
  await expect(voice).toBeVisible();
  const box = await voice.boundingBox();
  assert.ok(box && box.width >= 44 && box.height >= 44);
  await voice.click();
  const rec = await page.evaluate(() => {
    const current = (
      window as unknown as {
        __hermesSpeech?: { lang: string; continuous: boolean };
      }
    ).__hermesSpeech;
    return current ? { lang: current.lang, continuous: current.continuous } : null;
  });
  assert.equal(rec?.lang, "zh-TW");
  assert.equal(rec?.continuous, true);
  await page.evaluate(() => {
    const current = (
      window as unknown as {
        __hermesSpeech?: {
          onresult: ((event: {
            resultIndex?: number;
            results: Array<{ isFinal: boolean; 0: { transcript: string } }>;
          }) => void) | null;
        };
      }
    ).__hermesSpeech;
    current?.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: "我想辦茶會" } }],
    });
    current?.onresult?.({
      resultIndex: 1,
      results: [
        { isFinal: true, 0: { transcript: "我想辦茶會" } },
        { isFinal: true, 0: { transcript: "再幫我看場佈" } },
      ],
    });
  });
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toHaveValue(
    "我想辦茶會 再幫我看場佈",
  );
  await expect(page.getByText("說完了，請按送出")).toHaveCount(0);
  await page.evaluate(() => {
    const current = (
      window as unknown as {
        __hermesSpeech?: {
          onerror: ((event?: { error?: string }) => void) | null;
          onend: (() => void) | null;
        };
      }
    ).__hermesSpeech;
    current?.onerror?.({ error: "no-speech" });
    current?.onend?.();
  });
  await expect(page.getByRole("button", { name: "停止語音輸入" })).toBeVisible();
  await expect(page.getByText("說完了，請按送出")).toHaveCount(0);
  await expect(page.locator(".notice-bar.warning")).toHaveCount(0);
  await page.getByRole("button", { name: "停止語音輸入" }).click();
  await expect(page.getByText("說完了，請按送出")).toBeVisible();
  await page.screenshot({ path: join(output, "home-mobile.png"), fullPage: true });
  await page.screenshot({ path: join(output, "voice-ready-hint.png") });
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  await expect(page.getByRole("button", { name: /選方向 A/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("region", { name: "靈感方向" })).toBeVisible();
  await expect(page.getByText("不是 Hermes", { exact: true })).toBeVisible();
  await expect(page.getByText("沒有已收藏來源")).toBeVisible();
  await expect(page.getByText("連線頁")).toHaveCount(0);
  await expect(page.getByText("環境變數")).toHaveCount(0);
  await page.screenshot({ path: join(output, "spoken-goal-results.png") });
  await page.getByRole("button", { name: /選方向 A/ }).click();
  await expect(page.getByRole("region", { name: "已選方向規格" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/不是已出圖/)).toBeVisible();
  await expect(page.getByText(/不是 Hermes 生成/)).toBeVisible();
  await expect(page.locator(".conversation-scroll")).not.toContainText("210:297");
  await page.screenshot({ path: join(output, "spoken-goal-spec.png") });
  await voice.click();
  await page.evaluate(() => {
    const current = (
      window as unknown as {
        __hermesSpeech?: {
          onerror: ((event?: { error?: string }) => void) | null;
        };
      }
    ).__hermesSpeech;
    current?.onerror?.({ error: "no-speech" });
  });
  await expect(page.locator(".notice-bar.warning")).toContainText("沒聽到語音");
  await page.screenshot({ path: join(output, "voice-no-speech.png") });
  await page.getByRole("button", { name: "關閉提示" }).click();

  await page.locator(".connection-pill").click();
  await expect(page.getByRole("heading", { name: "能力", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "開發者檢視", exact: true })).toHaveCount(0);
  await expect(page.getByText("Hermes 憑證")).toHaveCount(0);
  await expect(page.getByText("填寫網址與權杖")).toHaveCount(0);
  await expect(page.getByText("尚未取得工具清單")).toHaveCount(0);
  await page.screenshot({
    path: join(output, "agent-status-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "快速導覽" })
    .getByRole("button", { name: "對話", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill("今天好嗎");
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  const notice = page.locator(".notice-bar.warning");
  await expect(notice).toContainText("還沒準備好", { timeout: 15_000 });
  await expect(notice).not.toContainText("連線頁");

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
