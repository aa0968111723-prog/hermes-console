import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { verifyVisualStates } from "./visual-states";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
      CONSOLE_ALLOW_LOCAL_ACCESS: "true",
      CONSOLE_GATEWAY_SECRET: "",
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
  await context.addInitScript({
    content: `
    window.__metrics = { lcp: null, cls: 0, supported: PerformanceObserver.supportedEntryTypes };
    if (PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint"))
      new PerformanceObserver(list => { for (const e of list.getEntries()) window.__metrics.lcp = e.startTime; }).observe({type:"largest-contentful-paint",buffered:true});
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift"))
      new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__metrics.cls += e.value; }).observe({type:"layout-shift",buffered:true});
  `,
  });
  const page = await context.newPage();
  const accessibility: { page: string; violations: unknown[] }[] = [];
  async function audit(name: string) {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    accessibility.push({
      page: name,
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    });
  }
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
      "受邀電子信箱",
      "寄送登入連結",
      "歡迎回到 Hermes",
      "正在驗證工作區存取",
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
  await expect(
    page.getByRole("textbox", { name: "訊息", exact: true }),
  ).toBeVisible();
  await page
    .locator(".turtle img")
    .evaluate((image: HTMLImageElement) => image.decode());
  await audit("home-desktop");
  const initialMetrics = await page.evaluate("window.__metrics");
  await assertNoLogin();
  await expect(page.locator(".connection-pill")).toContainText("未設定");
  await expect(page.locator(".quick-action-label")).toHaveCount(6);
  for (const label of await page
    .locator(".quick-action-label")
    .allTextContents())
    assert.ok(label.length <= 4, "quick actions should remain concise");
  await page.locator(".quick-action").first().click();
  await expect(
    page.getByRole("textbox", { name: "訊息", exact: true }),
  ).toHaveValue("幫我找網宣靈感。");
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill("");
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
    [1024, 900, "desktop-1024"],
    [768, 1024, "tablet"],
    [430, 900, "mobile-430"],
    [390, 844, "mobile-390"],
    [360, 800, "mobile-360"],
  ] as const) {
    await page.setViewportSize({ width, height });
    // Resize events and visualViewport updates are asynchronous. Observe the
    // actual layout instead of combining a stale send box with a new dock box.
    await expect.poll(() => page.locator(".app-shell").evaluate(el =>
      Math.round(el.getBoundingClientRect().height))).toBe(height);
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
    const columns = await page
      .locator(".quick-actions")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      );
    assert.equal(
      columns,
      width <= 760 ? 2 : width <= 1100 ? 3 : 6,
      "quick action layout at " + width,
    );
    if (width <= 760) {
      const dock = await page.locator(".mobile-bottom-dock").boundingBox();
      assert.ok(
        dock && send && send.y + send.height <= dock.y,
        "bottom dock overlaps send at "+width+": "+JSON.stringify({send,dock}),
      );
    }
    const composer = await page.locator(".composer").boundingBox();
    assert.ok(
      mascot && composer && mascot.y + mascot.height <= composer.y,
      "mascot overlaps composer",
    );
    await page.screenshot({
      path: join(output, name + ".png"),
      fullPage: true,
    });
    if (name === "desktop")
      await page.screenshot({
        path: join(output, "home-desktop.png"),
        fullPage: true,
      });
    if (name === "mobile-390")
      await page.screenshot({
        path: join(output, "home-mobile.png"),
        fullPage: true,
      });
  }
  await page.getByRole("button", { name: "開啟導覽" }).click();
  const mobileNavigation = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("navigation") });
  await mobileNavigation
    .getByRole("button", { name: "Agent", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Agent Runtime", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Hermes Runtime 狀態" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新同步", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await audit("agents");
  await page.screenshot({ path: join(output, "agents.png"), fullPage: true });
  const advancedRuntime = page.locator(".runtime-advanced > summary");
  await advancedRuntime.click();
  await page.screenshot({
    path: join(output, "runtime-advanced.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await expect(
    page.getByRole("dialog").filter({ has: page.getByRole("navigation") }),
  ).toBeVisible();
  await mobileNavigation
    .getByRole("button", { name: "靈感", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "靈感", exact: true }),
  ).toBeVisible();
  const syncButton = page.getByRole("button", { name: "匯入已設定來源" });
  await expect(syncButton).toBeVisible();
  assert.equal(
    (await (await context.request.get(base + "/api/inspiration")).json())
      .sheetsSync,
    null,
  );
  const syncBox = await syncButton.boundingBox();
  assert.ok(syncBox && syncBox.height >= 44);
  // UI error fixture only; the real import handler is independently covered in sheets-sync.test.ts.
  await page.route("**/api/inspiration", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    assert.equal(route.request().postDataJSON().action, "sync_sheets");
    await route.fulfill({
      status: 503,
      json: { error: { message: "測試來源暫時不可用，請重試。" } },
    });
  });
  await syncButton.click();
  await expect(
    page.locator(".inspiration-board").getByRole("alert"),
  ).toContainText("測試來源暫時不可用");
  await expect(syncButton).toBeEnabled();
  await page.unroute("**/api/inspiration");
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await mobileNavigation
    .getByRole("button", { name: "專案", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "素材與靈感" })).toBeVisible();
  await page.screenshot({ path: join(output, "projects.png"), fullPage: true });
  await page.locator(".reference-disclosure > summary").click();
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
  await mobileNavigation
    .getByRole("button", { name: "專案", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "官方 Hermes 文件" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByLabel("顯示龜龜", { exact: true }).uncheck();
  await page.getByRole("button", { name: "關閉面板" }).click();
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await mobileNavigation
    .getByRole("button", { name: "對話", exact: true })
    .click();
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
  await audit("settings-appearance");
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

  await page.getByRole("button", { name: "展開側欄", exact: true }).click();
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
  await verifyVisualStates(page, base, output, audit);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "browser-report.json"),
    JSON.stringify(
      {
        metrics: initialMetrics,
        accessibility,
        externalServices: "NOT verified",
      },
      null,
      2,
    ),
  );
  console.log(
    "Initial browser metrics (local Chrome): " + JSON.stringify(initialMetrics),
  );
  console.log("Accessibility: " + JSON.stringify(accessibility));
  assert.equal(
    accessibility.reduce((sum, item) => sum + item.violations.length, 0),
    0,
    "axe violations; inspect browser-report.json",
  );
  console.log(
    "PASS: no-login workspace, light-only, reduced motion, IME, Shift+Enter, 6 widths (360/390/430/768/1024/1440), small viewport, growing input, named dialogs/keyboard tabs/focus return, scoped drafts/attachments, denied storage, mascot, persisted reference. External services NOT verified.",
  );
  console.log("Screenshots: " + output);
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  await failedPage?.screenshot({path:join(output,"ui-failure.png"),fullPage:true}).catch(()=>{});
  throw error;
} finally {
  await browser?.close();
  child.kill();
}
