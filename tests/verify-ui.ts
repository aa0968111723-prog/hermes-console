import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";

// Real browser + real Console backend, isolated temporary owner/data.
// No Hermes/Canva credentials: screenshots show honest unconfigured status.
const dataDir = await mkdtemp(join(tmpdir(), "hermes-ui-"));
const password = randomBytes(28).toString("hex"),
  salt = randomBytes(16).toString("hex");
const port = Number(process.env.UI_TEST_PORT || 3215),
  base = "http://127.0.0.1:" + port;
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-p",
    String(port),
    "-H",
    "127.0.0.1",
  ],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      CONSOLE_ORIGIN: base,
      CONSOLE_USERNAME: "ui-validation-owner",
      CONSOLE_PASSWORD_HASH:
        "scrypt:" + salt + ":" + scryptSync(password, salt, 64).toString("hex"),
      CONSOLE_DATA_DIR: dataDir,
      HERMES_API_URL: "",
      HERMES_API_KEY: "",
      CANVA_CLIENT_ID: "",
      CANVA_CLIENT_SECRET: "",
      MCP_BRIDGE_TOKEN: "",
    },
  },
);
let serverOutput = "";
child.stdout?.on("data", (data) => {
  serverOutput += data.toString();
});
child.stderr?.on("data", (data) => {
  serverOutput += data.toString();
});
const output = resolve("output/playwright");
await mkdir(output, { recursive: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    if (child.exitCode !== null) throw new Error("Preview server exited");
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await expect(page.getByRole("button", { name: "進入工作區" })).toBeVisible();
  assert.equal(
    (await context.request.get(base + "/api/workspace")).status(),
    401,
  );
  await page.getByLabel("帳號", { exact: true }).fill("ui-validation-owner");
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "進入工作區" }).click();
  await expect(
    page.getByRole("heading", { name: "今天，想讓什麼好點子成形？" }),
  ).toBeVisible();
  await expect(page.locator(".connection-pill")).toContainText("未設定");
  assert.ok(
    (await context.cookies()).find((c) => c.name === "hermes_session")
      ?.httpOnly,
  );
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator("html")
      .evaluate((el) => getComputedStyle(el).colorScheme),
    "light",
  );
  assert.equal(
    await page
      .locator(".turtle img")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  const textarea = page.getByRole("textbox", { name: "訊息", exact: true });
  await textarea.fill("中文輸入測試");
  await textarea.dispatchEvent("compositionstart");
  await textarea.press("Enter");
  assert.ok((await textarea.inputValue()).startsWith("中文輸入測試"));
  assert.equal(
    (await (await context.request.get(base + "/api/workspace")).json())
      .conversations.length,
    0,
    "IME Enter must not submit or create a conversation",
  );
  assert.equal((await context.request.get(base + "/api/tasks")).status(), 200);
  await textarea.dispatchEvent("compositionend");
  await textarea.press("Shift+Enter");
  assert.match(await textarea.inputValue(), /\n/);
  await textarea.fill("");
  for (const [width, height, name] of [
    [1440, 1000, "desktop"],
    [768, 1024, "tablet"],
    [390, 844, "mobile-390"],
    [360, 800, "mobile-360"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(
      page.getByRole("heading", { name: "今天，想讓什麼好點子成形？" }),
    ).toBeVisible();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "horizontal overflow at " + width,
    );
    const send = await page
      .getByRole("button", { name: "送出訊息", exact: true })
      .boundingBox();
    assert.ok(
      send &&
        send.width >= 44 &&
        send.height >= 44 &&
        send.y + send.height <= height,
      "send button occluded at " + width,
    );
    const mascot = await page.locator(".turtle").boundingBox();
    const composer = await page.locator(".composer").boundingBox();
    assert.ok(
      mascot && composer && mascot.y + mascot.height <= composer.y,
      "mascot overlaps composer",
    );
    await page.screenshot({
      path: join(output, name + ".png"),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await expect(
    page.getByRole("dialog").filter({ has: page.getByRole("navigation") }),
  ).toBeVisible();
  await page.getByRole("button", { name: "素材", exact: true }).click();
  await expect(page.getByRole("heading", { name: "素材與靈感" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "參考標題" })
    .fill("官方 Hermes 文件");
  await page
    .getByRole("textbox", { name: "來源連結" })
    .fill("https://hermes-agent.nousresearch.com/docs/");
  await page.getByRole("button", { name: "收藏連結" }).click();
  await expect(
    page.getByRole("heading", { name: "官方 Hermes 文件" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await page.getByRole("button", { name: "素材", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "官方 Hermes 文件" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByLabel("顯示龜龜", { exact: true }).uncheck();
  await page.getByRole("button", { name: "關閉面板" }).click();
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await page.getByRole("button", { name: "對話", exact: true }).click();
  await expect(page.locator(".turtle")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".turtle")).toHaveCount(0);
  assert.deepEqual(errors, []);
  assert.ok(
    !serverOutput.includes(password),
    "plaintext password leaked to logs",
  );
  console.log(
    "PASS: real-browser auth, protected API, light-only, reduced motion, IME, Shift+Enter, 4 widths, touch/send bounds, mascot bounds/hide, drawer, persisted reference. External services NOT verified.",
  );
  console.log("Screenshots: " + output);
} finally {
  await browser?.close();
  child.kill();
}
