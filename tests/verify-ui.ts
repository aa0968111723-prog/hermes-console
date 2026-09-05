import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";


// Real browser + real Console backend, isolated temporary workspace/data.
// No Hermes/Canva credentials: screenshots show honest unconfigured status.
const dataDir = await mkdtemp(join(tmpdir(), "hermes-ui-"));
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
  async function assertNoLogin(target = page) {
    const text = await target.locator("body").innerText();
    for (const word of [
      "Login",
      "Sign In",
      "帳號",
      "Username",
      "Password",
      "登入",
      "註冊",
    ])
      assert.ok(!text.includes(word), "forbidden visible text: " + word);
  }
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "今天想做什麼？" }),
  ).toBeVisible();
  await assertNoLogin();
  assert.equal(
    (await context.request.get(base + "/api/workspace")).status(),
    200,
  );
  await page.goto(base);
  await expect(
    page.getByRole("heading", { name: "今天想做什麼？" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "訊息", exact: true })).toBeVisible();
  await assertNoLogin();
  await expect(page.locator(".connection-pill")).toContainText("未設定");
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
      page.getByRole("heading", { name: "今天想做什麼？" }),
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
  await page.getByRole("button", { name: "專案", exact: true }).click();
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
  await page.getByRole("button", { name: "專案", exact: true }).click();
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

  // Detail polish: named dialogs, keyboard tab navigation, and focus return.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settingsButton = page.getByRole("button", { name: "外觀設定" });
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: "工作區設定" });
  await expect(settings).toBeVisible();
  await page.getByRole("tab", { name: "外觀", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "專案", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveAccessibleName("專案");
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "外觀", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    path: join(output, "settings-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "settings-mobile-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");
  await expect(settings).not.toBeVisible();
  await expect(settingsButton).toBeFocused();

  // Real backend conversations; unsent drafts are private, tab-memory only.
  for (const title of ["草稿分流 A", "草稿分流 B"]) {
    const result = await context.request.post(base + "/api/conversations", {
      headers: { Origin: base },
      data: { title, projectId: "personal" },
    });
    assert.equal(result.status(), 201);
  }
  await page.getByRole("button", { name: "草稿分流 A", exact: true }).click();
  await textarea.fill("A 尚未送出的內容");
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route("**/api/materials?projectId=personal", async (route) => {
    const response = await route.fetch(); // Actual Console upload, only its delivery is delayed.
    await uploadGate;
    await route.fulfill({ response });
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "draft-a.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("真實上傳的測試附件"),
  });
  await page.getByRole("button", { name: "草稿分流 B", exact: true }).click();
  releaseUpload();
  await expect(textarea).toHaveValue("");
  await expect(page.locator(".upload-chip")).toHaveCount(0);
  await textarea.fill("B 獨立草稿");
  await page.getByRole("button", { name: "草稿分流 A", exact: true }).click();
  await expect(textarea).toHaveValue("A 尚未送出的內容");
  await expect(page.locator(".upload-chip")).toContainText("draft-a.txt");
  await expect(page.locator(".upload-chip")).toContainText("已保存");
  await page.unroute("**/api/materials?projectId=personal");
  await page.getByRole("button", { name: "草稿分流 B", exact: true }).click();
  await expect(textarea).toHaveValue("B 獨立草稿");

  await context.request.post(base + "/api/workspace", {
    headers: { Origin: base },
    data: { name: "獨立專案草稿" },
  });
  await page.getByRole("button", { name: "獨立專案草稿", exact: true }).click();
  await expect(textarea).toHaveValue("");
  await textarea.fill("只屬於這個專案的新對話草稿");
  await page.getByRole("button", { name: "個人工作區", exact: true }).click();
  await expect(textarea).toHaveValue("");
  await page.getByRole("button", { name: "獨立專案草稿", exact: true }).click();
  await expect(textarea).toHaveValue("只屬於這個專案的新對話草稿");
  await page.getByRole("button", { name: "個人工作區", exact: true }).click();
  await page.getByRole("button", { name: "草稿分流 B", exact: true }).click();
  await expect(textarea).toHaveValue("B 獨立草稿");

  // Textarea grows, stays bounded when the visible viewport shrinks, and shrinks again.
  const originalHeight = (await textarea.boundingBox())!.height;
  await textarea.fill(
    Array.from(
      { length: 30 },
      (_, i) => `第 ${i + 1} 行，較長的活動文案。`,
    ).join("\n"),
  );
  assert.ok((await textarea.boundingBox())!.height > originalHeight);
  await page.setViewportSize({ width: 390, height: 400 });
  const sendSmall = await page
    .getByRole("button", { name: "送出訊息", exact: true })
    .boundingBox();
  assert.ok(sendSmall && sendSmall.y + sendSmall.height <= 400);
  assert.ok((await textarea.boundingBox())!.height <= 113);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await textarea.fill("重新整理前仍保留的草稿");
  assert.ok((await textarea.boundingBox())!.height < 100);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(textarea).toHaveValue("重新整理前仍保留的草稿");
  await page.getByRole("button", { name: "草稿分流 A", exact: true }).click();
  await expect(textarea).toHaveValue("A 尚未送出的內容");

  // Storage may be denied by browser policy; it must not crash the workspace.
  const restricted = await browser.newContext();
  // Literal browser code avoids tsx's function-name helper leaking into serialization.
  await restricted.addInitScript({
    content: `for (const method of ["getItem", "setItem", "removeItem"]) {
    Object.defineProperty(Storage.prototype, method, { value: function () { throw new DOMException("Storage denied", "SecurityError"); } });
  }`,
  });
  const restrictedPage = await restricted.newPage();
  restrictedPage.on("pageerror", (e) => errors.push(e.message));
  await restrictedPage.goto(base);
  await assert.rejects(
    restrictedPage.evaluate("localStorage.getItem('probe')"),
    /Storage denied/,
  );
  await expect(
    restrictedPage.getByRole("heading", { name: "今天想做什麼？" }),
  ).toBeVisible();
  await expect(
    restrictedPage.getByRole("textbox", { name: "訊息", exact: true }),
  ).toBeVisible();
  await restrictedPage.getByRole("button", { name: "外觀設定" }).click();
  await restrictedPage
    .getByRole("combobox", { name: /文字大小/ })
    .selectOption("20");
  await expect(
    restrictedPage.getByRole("combobox", { name: /文字大小/ }),
  ).toHaveValue("20");
  await restricted.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: no-login workspace, light-only, reduced motion, IME, Shift+Enter, 4 widths, small viewport, growing input, named dialogs/keyboard tabs/focus return, scoped drafts/attachments, denied storage, mascot, persisted reference. External services NOT verified.",
  );
  console.log("Screenshots: " + output);
} finally {
  await browser?.close();
  child.kill();
}
