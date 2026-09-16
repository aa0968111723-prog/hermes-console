import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { verifyVisualStates } from "./visual-states";
import { verifyMobileSpatial } from "./mobile-spatial";
import { verifyMobileEngines } from "./mobile-engines";
import { verifyScrollOwnership } from "./mobile-scroll";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
const TEA = "幫我找淡大禪學社茶會宣傳靈感";
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
  browser = await chromium.launch({ headless: true });
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
  await expect(page.getByRole("link", { name: "跳至輸入區" })).not.toBeInViewport();
  await assertNoLogin();
  await expect(page.locator(".composer-task-status")).toHaveCount(0);
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
    [430, 932, "mobile-430"],
    [412, 915, "mobile-412"],
    [393, 852, "mobile-393"],
    [390, 844, "mobile-390"],
    [375, 812, "mobile-375"],
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
    await expect(page.locator(".quick-action")).toHaveCount(6);
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
      assert.equal(
        await page
          .locator(".mobile-bottom-dock")
          .evaluate(
            (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
          ),
        5,
        "mobile dock columns at " + width,
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
    if (name === "mobile-390") {
      await page.screenshot({
        path: join(output, "home-mobile.png"),
        fullPage: true,
      });
      await page.screenshot({
        path: join(output, "chat-mobile.png"),
        fullPage: true,
      });
    }
    if (
      name === "mobile-360" ||
      name === "mobile-390" ||
      name === "mobile-412" ||
      name === "mobile-430" ||
      name === "tablet"
    ) {
      await verifyScrollOwnership(page, name);
    }
  }
  const dockNav = page.getByRole("navigation", { name: "快速導覽" });
  await expect(dockNav).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill(TEA);
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /選方向 A/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(".message.assistant .message-byline"),
  ).toContainText("工作區");
  await expect(page.getByText("不是 Hermes", { exact: true })).toBeVisible();
  await expect(page.getByText("未搜全站")).toBeVisible();
  await expect(page.getByRole("region", { name: "靈感方向" })).toBeVisible();
  await expect(page.getByRole("button", { name: /選方向 A/ })).toBeInViewport();
  await expect(page.getByRole("button", { name: /選方向 B/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /選方向 C/ })).toBeVisible();
  const directionRail = page.locator(".inspiration-direction-grid").first();
  assert.ok(
    (await directionRail.evaluate((el) => el.scrollWidth - el.clientWidth)) > 40,
    "360px direction rail must overflow so C is reachable",
  );
  await expect(
    page.getByRole("button", { name: "回到最新訊息" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "查看目前任務：完成", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".conversation-scroll")
      .getByText("已從工作區整理創作方向"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /選方向 A/ })).toHaveCount(1);
  await expect(page.getByText(/個工具完成/)).toHaveCount(0);
  await expect(page.getByText(/已搜尋整個 Instagram/)).toHaveCount(0);
  await page.screenshot({
    path: join(output, "chat-inspiration-mobile.png"),
  });
  await directionRail.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(page.getByRole("button", { name: /選方向 C/ })).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "回到最新訊息" }),
  ).toHaveCount(0);
  await directionRail.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect(page.getByRole("button", { name: /選方向 A/ })).toBeInViewport();
  await page.getByRole("button", { name: /選方向 A/ }).click();
  await expect(page.getByRole("region", { name: "已選方向規格" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("region", { name: "已選方向規格" }).locator(".direction-format-frame"),
  ).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "已選方向規格" }).locator(".direction-format-frame").first(),
  ).toContainText("最自然");
  await expect(
    page.getByRole("region", { name: "已選方向規格" }).locator(".direction-format-copy").first(),
  ).toContainText("茶會來坐一下");
  await expect(
    page.getByRole("region", { name: "已選方向規格" }),
  ).toContainText("海報 A4");
  await expect(page.locator(".conversation-scroll")).not.toContainText(
    "210:297",
  );
  await expect(page.getByText("最自然")).toBeVisible();
  await expect(page.getByText(/不是已出圖/)).toBeVisible();
  await expect(page.getByText(/不是 Hermes 生成/)).toBeVisible();
  await expect(page.getByText(/Hermes 尚未連線/)).toBeVisible();
  const chatBrief = page.getByRole("region", { name: "已選方向規格" });
  await expect(
    chatBrief.locator(".direction-format-frame").first(),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "回到最新訊息" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: join(output, "chat-direction-brief-mobile.png"),
  });
  await page.getByRole("button", { name: "任務與成果" }).click();
  const specStage = page.getByRole("region", { name: "規格草稿預覽" });
  await expect(specStage).toBeVisible();
  await expect(specStage).toContainText("規格草稿");
  await expect(specStage).toContainText("未出圖");
  await expect(specStage).toContainText("最自然");
  await expect(specStage).toContainText("茶會來坐一下");
  await expect(specStage.locator(".canva-result")).toHaveCount(0);
  await expect(page.getByText("Canva 草稿")).toHaveCount(0);
  await page.screenshot({
    path: join(output, "chat-direction-artifact-mobile.png"),
  });
  await page.getByRole("button", { name: "對話列表" }).click();
  await page
    .getByRole("dialog", { name: "對話列表" })
    .getByRole("button", { name: "開啟新對話" })
    .click();
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await page.getByRole("button", { name: "任務與成果" }).click();
  await page.getByRole("button", { name: "在對話修改這個作品" }).click();
  await expect(
    page.getByRole("textbox", { name: "訊息", exact: true }),
  ).toHaveValue("請接續修改同一作品。");
  await expect(
    page.getByRole("heading", { name: "今天想做什麼？" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".conversation-scroll").getByRole("region", { name: "已選方向規格" }),
  ).toContainText("V1");
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  await expect(
    page.locator(".conversation-scroll").getByText("請接續修改同一作品。"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(".conversation-scroll").getByRole("region", { name: "已選方向規格" }),
  ).toContainText("V1");
  await expect(
    page.locator(".conversation-scroll").getByRole("region", { name: "已選方向規格" }),
  ).not.toContainText("V2");
  await expect(
    page.getByRole("button", { name: "回到最新訊息" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "訊息", exact: true }),
  ).toHaveValue("");
  await page.screenshot({
    path: join(output, "chat-direction-continue-mobile.png"),
  });
  await dockNav.getByRole("button", { name: "對話", exact: true }).click();
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill("第二版字放大");
  await expect(page.getByRole("button", { name: "送出訊息", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  const revisedBrief = page.getByRole("region", { name: "已選方向規格" });
  await expect(revisedBrief).toContainText("V2", { timeout: 15_000 });
  await expect(revisedBrief).toContainText("主標加大");
  await expect(revisedBrief).toContainText("未出圖");
  await expect(revisedBrief.locator(".direction-format-copy").first()).toHaveAttribute(
    "data-emphasis",
    "larger",
  );
  await expect(page.getByText("Canva 草稿")).toHaveCount(0);
  await page.screenshot({
    path: join(output, "chat-direction-revision-mobile.png"),
  });
  await page.getByRole("button", { name: "任務與成果" }).click();
  await expect(specStage).toContainText("V2");
  await expect(specStage).toContainText("主標加大");
  await expect(specStage.locator(".canva-result")).toHaveCount(0);
  await page.getByRole("button", { name: "對話列表" }).click();
  const conversationDrawer = page.getByRole("dialog", { name: "對話列表" });
  await expect(conversationDrawer).toBeVisible();
  await conversationDrawer.getByRole("button", { name: "開啟新對話" }).click();
  await expect(page.getByRole("heading", { name: "今天想做什麼？" })).toBeVisible();
  await expect(
    page.locator(".conversation-scroll").getByRole("region", { name: "已選方向規格" }),
  ).toHaveCount(0);
  await expect(page.getByText(/規格已整理/)).toHaveCount(0);
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill(
    "幫我查淡大禪學社茶會",
  );
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  const clubFacts = page.getByRole("region", { name: "社團資料" });
  await expect(clubFacts).toBeVisible({ timeout: 15_000 });
  await expect(clubFacts).toContainText("茶會");
  await expect(clubFacts).toContainText("未提供");
  await expect(clubFacts).toContainText("尚未確認");
  await expect(page.getByRole("region", { name: "靈感方向" })).toHaveCount(0);
  await expect(page.locator(".conversation-scroll")).not.toContainText("UNKNOWN");
  await expect(page.locator(".conversation-scroll")).not.toContainText("live=");
  await expect(
    page.locator(".message.assistant .message-byline"),
  ).toContainText("工作區");
  await page.screenshot({
    path: join(output, "chat-knowledge-mobile.png"),
  });
  const poster = await readFile("public/mascot/turtle.png");
  await page.locator('#composer input[type="file"]').setInputFiles({
    name: "茶會海報.png",
    mimeType: "image/png",
    buffer: poster,
  });
  await expect(page.locator(".context-card")).toContainText("尚未驗證讀圖", {
    timeout: 30_000,
  });
  await page.getByRole("textbox", { name: "訊息", exact: true }).fill("這張哪裡可以改？");
  await page.getByRole("button", { name: "送出訊息", exact: true }).click();
  const imageReview = page.getByRole("region", { name: "畫面審查" });
  await expect(imageReview).toBeVisible({ timeout: 15_000 });
  await expect(imageReview).toContainText("沒有讀取像素");
  await expect(imageReview).toContainText("未讀像素");
  await expect(
    page.getByRole("region", { name: "新生第一眼模擬" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "新生第一眼模擬" }).getByText("較會停"),
  ).toBeVisible();
  const twinFold = page.locator(".twin-fold");
  await expect(twinFold.getByText("十個視角")).toBeVisible();
  await expect(twinFold.locator(".twin-card")).toHaveCount(10);
  await expect(twinFold.locator(".twin-card").first()).toBeHidden();
  await expect(page.getByText(/個工具完成/)).toHaveCount(0);
  await expect(page.getByText(/已讀取像素/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "查看目前任務：完成", exact: true }),
  ).toHaveCount(0);
  await expect(imageReview).toBeInViewport();
  await page.screenshot({
    path: join(output, "chat-image-review-mobile.png"),
  });
  await expect(page.getByRole("button", { name: "對話列表" })).toBeVisible();
  await page.getByRole("button", { name: "對話列表" }).click();
  await expect(conversationDrawer).toBeVisible();
  await expect(
    conversationDrawer.getByRole("navigation", { name: "主要導覽" }),
  ).toHaveCount(0);
  await page.screenshot({ path: join(output, "drawer.png"), fullPage: true });
  await conversationDrawer.getByRole("button", { name: "關閉導覽" }).click();
  await dockNav.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "能力", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Hermes Runtime 狀態" }),
  ).toBeVisible();
  await expect(
    page.locator(".runtime-human-summary"),
  ).toContainText("Hermes");
  await expect(
    page.locator(".runtime-human-summary"),
  ).not.toContainText("/");
  await expect(page.getByText("Agent OS")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "開發者檢視", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重新同步", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: join(output, "runtime-mobile-360.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await audit("agents");
  await page.screenshot({ path: join(output, "agents.png"), fullPage: true });
  await page.screenshot({
    path: join(output, "runtime-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "外觀設定", exact: true }).click();
  await page.getByRole("tab", { name: "進階", exact: true }).click();
  await page.getByRole("checkbox", { name: /顯示維運檢視/ }).check();
  await page.getByRole("button", { name: "關閉面板", exact: true }).click();
  await page.getByRole("button", { name: "開發者檢視", exact: true }).click();
  const advancedRuntime = page.locator(".runtime-advanced > summary");
  await expect(advancedRuntime).toBeVisible();
  await advancedRuntime.click();
  await page.screenshot({
    path: join(output, "runtime-advanced.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "任務與成果" }).click();
  await expect(
    page.getByRole("heading", { name: "任務", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "對話列表" }).click();
  await expect(conversationDrawer).toBeVisible();
  await conversationDrawer.getByRole("button", { name: "關閉導覽" }).click();
  await dockNav.getByRole("button", { name: "靈感", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "靈感", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("未搜全站")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "靈感方向" }),
  ).toBeVisible();
  const inspirationJson = await (
    await context.request.get(base + "/api/inspiration")
  ).json();
  assert.equal(inspirationJson.sheetsSync, null);
  assert.equal(inspirationJson.pack.fullSiteSearch, false);
  assert.equal(inspirationJson.pack.kind, "inspiration_search");
  assert.ok(inspirationJson.pack.directions.length >= 1);
  const pickA = page
    .locator(".inspiration-board")
    .getByRole("button", { name: /選方向 A/ });
  await expect(pickA).toBeVisible();
  assert.equal(
    await page.locator(".secondary-page").evaluate((el) => el.scrollTop),
    0,
    "切到靈感必須從頁頂開始，不能沿用任務頁捲動",
  );
  await expect(pickA).toBeInViewport();
  const pickBox = await pickA.boundingBox();
  assert.ok(pickBox && pickBox.height >= 44);
  assert.ok(
    pickBox.y >= 0 && pickBox.y + pickBox.height <= 800,
    "360px 靈感第一屏必須看得到選方向 A，不能被規格框或 Drive 知識擠掉",
  );
  await expect(page.getByRole("heading", { name: "Drive 知識" })).toHaveCount(0);
  const knowledgeFold = page.locator(".knowledge-fold > summary");
  await expect(knowledgeFold).toHaveText("Drive 知識");
  const knowledgeBox = await knowledgeFold.boundingBox();
  assert.ok(knowledgeBox && knowledgeBox.y > pickBox.y);
  const a4Frame = page
    .locator(".direction-format-frame")
    .filter({ hasText: /A4/ })
    .first();
  if ((await a4Frame.count()) > 0) {
    const a4Box = await a4Frame.boundingBox();
    assert.ok(a4Box && a4Box.y > pickBox.y, "A4 規格框必須在方向卡下面");
  }
  await page.screenshot({
    path: join(output, "inspiration-mobile.png"),
    fullPage: true,
  });
  const syncButton = page.getByRole("button", { name: "匯入已設定來源" });
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
  await pickA.click();
  await expect(page.getByRole("region", { name: "已選方向規格" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "已選方向規格" }).locator(".direction-format-copy").first(),
  ).toContainText("茶會來坐一下");
  await expect(page.getByText(/不是已出圖/)).toBeVisible();
  await expect(page.getByText(/不是 Hermes 生成/)).toBeVisible();
  const boardBrief = page.getByRole("region", { name: "已選方向規格" });
  await boardBrief.locator(".direction-format-frame").first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "direction-brief-mobile.png"),
  });
  await dockNav.getByRole("button", { name: "專案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "素材與靈感" })).toBeVisible();
  await page.screenshot({ path: join(output, "projects.png"), fullPage: true });
  await page.screenshot({ path: join(output, "project.png"), fullPage: true });
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
  await dockNav.getByRole("button", { name: "專案", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "官方 Hermes 文件" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "外觀設定" }).click();
  await page.getByLabel("顯示龜龜", { exact: true }).uncheck();
  await page.getByRole("button", { name: "關閉面板" }).click();
  await dockNav.getByRole("button", { name: "對話", exact: true }).click();
  await expect(page.locator(".turtle")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".turtle")).toHaveCount(0);

  // Detail polish: named dialogs, keyboard tab navigation, and focus return.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const settingsButton = page.getByRole("button", { name: "外觀設定" });
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: "工作區設定" });
  await expect(settings).toBeVisible();
  await page.getByRole("tab", { name: "帳號", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "進階", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveAccessibleName("進階");
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "帳號", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "外觀", exact: true }).click();
  await audit("settings-appearance");
  await page.screenshot({
    path: join(output, "settings-desktop.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(output, "modal.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "settings-mobile-390.png"),
    fullPage: true,
  });
  await page.screenshot({
    path: join(output, "settings.png"),
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
  await page.locator('#composer input[type="file"]').setInputFiles({
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
  // visualViewport / ResizeObserver updates are async; CSS 28dvh cap should
  // bound immediately, then wait until the used box is the short viewport.
  await expect
    .poll(() =>
      page
        .locator(".app-shell")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(400);
  const sendSmall = await page
    .getByRole("button", { name: "送出訊息", exact: true })
    .boundingBox();
  assert.ok(sendSmall && sendSmall.y + sendSmall.height <= 400);
  await expect
    .poll(async () => (await textarea.boundingBox())!.height)
    .toBeLessThanOrEqual(113);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  // A software keyboard shrinks visualViewport while the layout viewport
  // remains tall. The bottom dock should yield that space only while the
  // composer owns the keyboard.
  await page.setViewportSize({ width: 390, height: 844 });
  await textarea.focus();
  await expect
    .poll(() =>
      page
        .locator(".app-shell")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(844);
  await page.evaluate(() => {
    if (!window.visualViewport) throw new Error("visualViewport unavailable");
    Object.defineProperty(window.visualViewport, "height", {
      configurable: true,
      value: 420,
    });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-composer-keyboard",
    "open",
  );
  await expect(page.locator(".mobile-bottom-dock")).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator(".app-shell")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(420);
  const keyboardSend = await page
    .getByRole("button", { name: "送出訊息", exact: true })
    .boundingBox();
  assert.ok(
    keyboardSend && keyboardSend.y + keyboardSend.height <= 420,
    "software keyboard must not cover the send button",
  );
  await page.screenshot({
    path: join(output, "composer-keyboard-390x420.png"),
    clip: { x: 0, y: 0, width: 390, height: 420 },
  });
  await page.screenshot({
    path: join(output, "keyboard.png"),
    clip: { x: 0, y: 0, width: 390, height: 420 },
  });
  await page.evaluate(() => {
    if (!window.visualViewport) return;
    Reflect.deleteProperty(window.visualViewport, "height");
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-composer-keyboard",
    "open",
  );
  await expect(page.locator(".mobile-bottom-dock")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".app-shell")
        .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    )
    .toBe(844);
  assert.equal(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--app-height")
        .trim(),
    ),
    "100dvh",
  );
  await page.screenshot({
    path: join(output, "long-chat.png"),
    fullPage: true,
  });
  await textarea.fill("重新整理前仍保留的草稿");
  assert.ok((await textarea.boundingBox())!.height < 100);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(textarea).toHaveValue("重新整理前仍保留的草稿");
  await page.getByRole("button", { name: "草稿分流 A", exact: true }).click();
  await expect(textarea).toHaveValue("A 尚未送出的內容");

  const loginContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await loginContext.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        required: true,
        user: null,
        membership: null,
        providers: [
          {
            id: "google",
            configured: false,
            message: "Google 登入尚未完成設定",
          },
          {
            id: "tamkang",
            configured: false,
            message: "淡江 SSO 尚未完成設定",
          },
          {
            id: "email",
            configured: false,
            message: "電子信箱驗證尚未完成寄信設定",
          },
        ],
      }),
    }),
  );
  const loginPage = await loginContext.newPage();
  await loginPage.goto(base);
  await expect(
    loginPage.getByRole("heading", { name: "登入 Hermes" }),
  ).toBeVisible();
  await expect(
    loginPage.getByRole("button", { name: /Google 登入尚未完成設定/ }),
  ).toBeDisabled();
  await expect(
    loginPage.getByRole("button", { name: /淡江 SSO 尚未完成設定/ }),
  ).toBeDisabled();
  await loginPage.screenshot({
    path: join(output, "login-mobile.png"),
    fullPage: true,
  });
  const resetPage = await loginContext.newPage();
  await resetPage.goto(base + "/#reset=" + "a".repeat(64));
  await expect(
    resetPage.getByRole("heading", { name: "重設密碼" }),
  ).toBeVisible();
  await expect(resetPage.getByLabel("新密碼")).toBeVisible();
  await expect(
    resetPage.getByRole("button", { name: "儲存新密碼" }),
  ).toBeVisible();
  await resetPage.screenshot({
    path: join(output, "reset-mobile.png"),
    fullPage: true,
  });
  await loginContext.close();

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
  await verifyMobileSpatial(page,base,output,audit);
  await verifyVisualStates(page, base, output, audit);
  await verifyMobileEngines(base,output);
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
